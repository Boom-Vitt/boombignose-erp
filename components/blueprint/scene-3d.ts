import * as THREE from "three"
import type {
  AssemblyId,
  BlueprintSceneModel,
} from "@/lib/blueprint/scene-data"

export interface ProjectedAnchor {
  id: AssemblyId
  x: number
  y: number
  elbowX: number
  elbowY: number
  visible: boolean
}

export interface BlueprintEngine {
  setSheet(sheetIndex: number): void
  setExploded(exploded: boolean): void
  selectAssembly(id: AssemblyId | null): void
  dispose(): void
}

const PAPER_HEX = "#f6f3ec"
const NAVY_HEX = "#0f2547"
const INK_MID_HEX = "#1e3a6d"
const BLOCK_FILL_HEX = "#ede8dd"
const HOUSING_FILL_HEX = "#e4dfd2"
const HIGHLIGHT_FILL_HEX = "#d4deef"
const ACCENT_TOKEN_HEX = "#b44c1c"

export function canCreateWebGLContext(): boolean {
  if (typeof document === "undefined") return false
  try {
    const probe = document.createElement("canvas")
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl")
    return Boolean(gl)
  } catch {
    return false
  }
}

export function createBlueprintEngine(
  host: HTMLElement,
  model: BlueprintSceneModel,
  opts: {
    reducedMotion: boolean
    onAnchors?(anchors: ProjectedAnchor[], tokenStepIndex: number): void
    onSelect?(id: AssemblyId): void
  }
): BlueprintEngine | null {
  if (!canCreateWebGLContext()) return null

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    })
  } catch {
    return null
  }

  const maxDpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(maxDpr)
  renderer.setClearColor(PAPER_HEX, 1)
  renderer.domElement.style.display = "block"
  renderer.domElement.style.width = "100%"
  renderer.domElement.style.height = "100%"
  renderer.domElement.setAttribute(
    "aria-label",
    "Axonometric 3D exploded blueprint of the ERP machine"
  )
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PAPER_HEX)

  const frustumSize = 8.4
  const camera = new THREE.OrthographicCamera(
    -frustumSize / 2,
    frustumSize / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    120
  )

  // Toon gradient map (2-step flat engineering shading)
  const rampData = new Uint8Array([215, 215, 215, 255, 250, 250, 250, 255])
  const gradientMap = new THREE.DataTexture(rampData, 2, 1, THREE.RGBAFormat)
  gradientMap.minFilter = THREE.NearestFilter
  gradientMap.magFilter = THREE.NearestFilter
  gradientMap.needsUpdate = true

  scene.add(new THREE.AmbientLight("#ffffff", 1.85))
  const keyLight = new THREE.DirectionalLight("#ffffff", 1.15)
  keyLight.position.set(8, 14, 10)
  scene.add(keyLight)

  const edgeMat = new THREE.LineBasicMaterial({ color: NAVY_HEX })
  const subEdgeMat = new THREE.LineBasicMaterial({
    color: INK_MID_HEX,
    transparent: true,
    opacity: 0.55,
  })
  const guideMat = new THREE.LineDashedMaterial({
    color: INK_MID_HEX,
    dashSize: 0.18,
    gapSize: 0.12,
    transparent: true,
    opacity: 0.55,
  })
  const conduitMat = new THREE.LineBasicMaterial({
    color: ACCENT_TOKEN_HEX,
  })

  const baseBlockMat = new THREE.MeshToonMaterial({
    color: BLOCK_FILL_HEX,
    gradientMap,
  })
  const housingMat = new THREE.MeshToonMaterial({
    color: HOUSING_FILL_HEX,
    gradientMap,
  })
  const highlightMat = new THREE.MeshToonMaterial({
    color: HIGHLIGHT_FILL_HEX,
    gradientMap,
  })
  const detailMat = new THREE.MeshToonMaterial({
    color: "#dfdad0",
    gradientMap,
  })
  const tokenMat = new THREE.MeshBasicMaterial({
    color: ACCENT_TOKEN_HEX,
  })

  // Reference drafting grid on the base plane
  const grid = new THREE.GridHelper(13, 13, INK_MID_HEX, "#cfc8b8")
  grid.position.set(0, -1.95, -0.4)
  scene.add(grid)

  const machineRoot = new THREE.Group()
  scene.add(machineRoot)

  interface AssemblyNode {
    id: AssemblyId
    group: THREE.Group
    primaryMesh: THREE.Mesh
    isHousing: boolean
    assembled: THREE.Vector3
    exploded: THREE.Vector3
    guideLine: THREE.Line
  }

  const nodes = new Map<AssemblyId, AssemblyNode>()
  const pickMeshes: THREE.Object3D[] = []

  function addEdgedBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    lineMat: THREE.LineBasicMaterial,
    x = 0,
    y = 0,
    z = 0
  ) {
    const geo = new THREE.BoxGeometry(w, h, d)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    const edges = new THREE.EdgesGeometry(geo)
    const lines = new THREE.LineSegments(edges, lineMat)
    mesh.add(lines)
    return mesh
  }

  const isCompact = host.clientWidth > 0 && host.clientWidth <= 420

  for (const spec of model.assemblies) {
    const group = new THREE.Group()
    const assembled = new THREE.Vector3(...spec.assembledPosition)
    const exploded = new THREE.Vector3(...spec.explodedOffset)
    group.position.copy(exploded)

    const [w, h, d] = spec.size
    const isHousing = spec.id === "08-tenant-housing"
    const primaryMesh = addEdgedBox(
      group,
      w,
      h,
      d,
      isHousing ? housingMat : baseBlockMat,
      edgeMat
    )
    primaryMesh.userData.assemblyId = spec.id
    pickMeshes.push(primaryMesh)

    // Architectural sub-features so each module looks like a distinct mechanical sub-assembly
    if (!isCompact) {
      if (isHousing) {
        // Perimeter rails and RLS partition ribs
        addEdgedBox(group, w - 0.3, 0.16, 0.16, detailMat, subEdgeMat, 0, h / 2 + 0.08, d / 2 - 0.15)
        addEdgedBox(group, w - 0.3, 0.16, 0.16, detailMat, subEdgeMat, 0, h / 2 + 0.08, -d / 2 + 0.15)
        for (const rx of [-2.2, 0, 2.2]) {
          addEdgedBox(group, 0.14, 0.12, d - 0.4, detailMat, subEdgeMat, rx, h / 2 + 0.06, 0)
        }
      } else if (spec.id === "01-crm-deals" || spec.id === "02-quotes") {
        // Stacked document trays
        addEdgedBox(group, w * 0.72, 0.18, d * 0.65, detailMat, subEdgeMat, 0, h / 2 + 0.09, 0)
      } else if (spec.id === "03-projects") {
        // Three milestone blocks on top
        for (const mx of [-0.6, 0, 0.6]) {
          addEdgedBox(group, 0.42, 0.24, 0.7, detailMat, subEdgeMat, mx, h / 2 + 0.12, 0)
        }
      } else if (spec.id === "04-invoices") {
        // Satang ledger Plinth + snapshot plate
        addEdgedBox(group, w * 0.8, 0.22, d * 0.7, detailMat, subEdgeMat, 0, h / 2 + 0.11, 0)
      } else if (spec.id === "05-payments") {
        // Three-stage gate: claim -> verify -> allocate
        for (const gx of [-0.68, 0, 0.68]) {
          addEdgedBox(group, 0.52, 0.26, 0.85, detailMat, subEdgeMat, gx, h / 2 + 0.13, 0)
        }
      } else if (spec.id === "06-subscriptions") {
        // Outbox cylinder/dispatch block
        addEdgedBox(group, w * 0.6, 0.25, d * 0.6, detailMat, subEdgeMat, 0, h / 2 + 0.125, 0)
      } else if (spec.id === "07-ai-unit") {
        // Read-only AI manifold cap
        addEdgedBox(group, w * 0.65, 0.2, d * 0.65, detailMat, subEdgeMat, 0, h / 2 + 0.1, 0)
      }
    }

    // Explode projection line connecting assembled origin to exploded position
    const guideGeo = new THREE.BufferGeometry().setFromPoints([
      assembled.clone(),
      exploded.clone(),
    ])
    const guideLine = new THREE.Line(guideGeo, guideMat)
    guideLine.computeLineDistances()
    machineRoot.add(guideLine)

    machineRoot.add(group)
    nodes.set(spec.id, {
      id: spec.id,
      group,
      primaryMesh,
      isHousing,
      assembled,
      exploded,
      guideLine,
    })
  }

  // Document token & conduit path: quote -> project -> invoice -> claim -> verification -> allocation
  const waypoints = model.tokenPath.map((w) => new THREE.Vector3(...w.position))
  const tokenCurve = new THREE.CatmullRomCurve3(waypoints, false, "centripetal")
  const conduitPoints = tokenCurve.getPoints(48)
  const conduitGeo = new THREE.BufferGeometry().setFromPoints(conduitPoints)
  const conduitLine = new THREE.Line(conduitGeo, conduitMat)
  machineRoot.add(conduitLine)

  const tokenGroup = new THREE.Group()
  const tokenGeo = new THREE.OctahedronGeometry(0.24, 0)
  const tokenMesh = new THREE.Mesh(tokenGeo, tokenMat)
  const tokenEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(tokenGeo),
    edgeMat
  )
  tokenMesh.add(tokenEdges)
  tokenGroup.add(tokenMesh)
  tokenGroup.position.copy(waypoints[0] ?? new THREE.Vector3())
  machineRoot.add(tokenGroup)

  let selectedId: AssemblyId | null = null
  let currentExplode = opts.reducedMotion ? 1 : 1
  let targetExplode = 1

  const currentCamPos = new THREE.Vector3(...model.sheets[0]!.cameraPosition)
  const targetCamPos = currentCamPos.clone()
  const currentCamTarget = new THREE.Vector3(...model.sheets[0]!.cameraTarget)
  const targetCamTarget = currentCamTarget.clone()
  let currentZoom = model.sheets[0]!.cameraZoom
  let targetZoom = currentZoom

  function syncCameraProjection() {
    const w = Math.max(host.clientWidth, 1)
    const h = Math.max(host.clientHeight, 1)
    const aspect = w / h
    const halfH = frustumSize / 2
    const halfW = halfH * aspect
    camera.left = -halfW
    camera.right = halfW
    camera.top = halfH
    camera.bottom = -halfH
    camera.zoom = currentZoom * (aspect < 0.85 ? 0.78 : 1)
    camera.position.copy(currentCamPos)
    camera.lookAt(currentCamTarget)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  function applyPositions(explodeK: number) {
    for (const node of nodes.values()) {
      node.group.position.lerpVectors(node.assembled, node.exploded, explodeK)
      const pts = [node.assembled, node.group.position]
      node.guideLine.geometry.setFromPoints(pts)
      node.guideLine.computeLineDistances()
    }
    // Recompute conduit points relative to current assembly positions
    const dynamicWaypoints = model.tokenPath.map((w) => {
      const node = nodes.get(w.assemblyId)
      const base = new THREE.Vector3(...w.position)
      if (!node) return base
      const delta = node.group.position.clone().sub(node.assembled)
      return base.add(delta)
    })
    const dynCurve = new THREE.CatmullRomCurve3(
      dynamicWaypoints,
      false,
      "centripetal"
    )
    conduitLine.geometry.setFromPoints(dynCurve.getPoints(48))
    return dynCurve
  }

  let tokenProgress = 0.15
  const tmpVec = new THREE.Vector3()

  function computeAnchors(tokenStepIdx: number) {
    if (!opts.onAnchors) return
    const w = Math.max(host.clientWidth, 1)
    const h = Math.max(host.clientHeight, 1)
    const list: ProjectedAnchor[] = []
    for (const spec of model.assemblies) {
      const node = nodes.get(spec.id)!
      tmpVec.copy(node.group.position)
      tmpVec.y += spec.size[1] * 0.45
      tmpVec.project(camera)
      const x = (tmpVec.x * 0.5 + 0.5) * w
      const y = (-tmpVec.y * 0.5 + 0.5) * h
      const side = x < w * 0.5 ? -1 : 1
      const elbowX = Math.max(24, Math.min(w - 24, x + side * 34))
      const elbowY = Math.max(24, Math.min(h - 24, y - 22))
      list.push({
        id: spec.id,
        x,
        y,
        elbowX,
        elbowY,
        visible: tmpVec.z >= -1 && tmpVec.z <= 1,
      })
    }
    opts.onAnchors(list, tokenStepIdx)
  }

  function renderOnce(dynCurve: THREE.CatmullRomCurve3, tokenStepIdx: number) {
    const pt = dynCurve.getPointAt(Math.min(Math.max(tokenProgress, 0), 1))
    tokenGroup.position.copy(pt)
    syncCameraProjection()
    renderer.render(scene, camera)
    computeAnchors(tokenStepIdx)
  }

  const resize = () => {
    const w = Math.max(host.clientWidth, 1)
    const h = Math.max(host.clientHeight, 1)
    renderer.setSize(w, h, false)
    const curveNow = applyPositions(currentExplode)
    const stepIdx = Math.min(
      model.tokenPath.length - 1,
      Math.floor(tokenProgress * model.tokenPath.length)
    )
    renderOnce(curveNow, stepIdx)
  }

  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(host)

  // Raycast click on 3D blocks
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const onPointerUp = (ev: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(pickMeshes, false)[0]
    const id = hit?.object?.userData?.assemblyId as AssemblyId | undefined
    if (id) {
      api.selectAssembly(id)
      opts.onSelect?.(id)
    }
  }
  renderer.domElement.addEventListener("pointerup", onPointerUp)

  // Pause rendering when offscreen or document hidden
  let isVisible = true
  let isPageVisible = typeof document !== "undefined" ? !document.hidden : true
  let rafId = 0
  let lastTime = performance.now()
  let anchorEmitTimer = 0

  function shouldAnimate() {
    return !opts.reducedMotion && isVisible && isPageVisible
  }

  function tick(now = performance.now()) {
    if (!shouldAnimate()) {
      rafId = 0
      return
    }
    rafId = requestAnimationFrame(tick)
    const dt = Math.min((now - lastTime) / 1000, 0.05)
    lastTime = now

    const k = 1 - Math.exp(-dt * 6)
    currentExplode = THREE.MathUtils.lerp(currentExplode, targetExplode, k)
    currentCamPos.lerp(targetCamPos, k)
    currentCamTarget.lerp(targetCamTarget, k)
    currentZoom = THREE.MathUtils.lerp(currentZoom, targetZoom, k)

    tokenProgress = (tokenProgress + dt * 0.085) % 1
    tokenMesh.rotation.y += dt * 1.1

    const dynCurve = applyPositions(currentExplode)
    const pt = dynCurve.getPointAt(tokenProgress)
    tokenGroup.position.copy(pt)

    syncCameraProjection()
    renderer.render(scene, camera)

    anchorEmitTimer += dt
    if (anchorEmitTimer >= 0.12) {
      anchorEmitTimer = 0
      const stepIdx = Math.min(
        model.tokenPath.length - 1,
        Math.floor(tokenProgress * model.tokenPath.length)
      )
      computeAnchors(stepIdx)
    }
  }

  function ensureLoopState() {
    if (shouldAnimate() && !rafId) {
      lastTime = performance.now()
      rafId = requestAnimationFrame(tick)
    } else if (!shouldAnimate() && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            const entry = entries[0]
            if (entry) {
              isVisible = entry.isIntersecting
              ensureLoopState()
            }
          },
          { threshold: 0.05 }
        )
      : null
  io?.observe(host)

  const onVisibilityChange = () => {
    isPageVisible = !document.hidden
    ensureLoopState()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  // Initial synchronous draw so canvas is non-blank immediately (even under reducedMotion)
  const initialCurve = applyPositions(currentExplode)
  renderOnce(initialCurve, 0)
  ensureLoopState()

  const api: BlueprintEngine = {
    setSheet(sheetIndex: number) {
      const sheet =
        model.sheets[
          Math.max(0, Math.min(model.sheets.length - 1, sheetIndex))
        ]!
      targetExplode = sheet.explodeFactor
      targetCamPos.set(...sheet.cameraPosition)
      targetCamTarget.set(...sheet.cameraTarget)
      targetZoom = sheet.cameraZoom
      if (opts.reducedMotion) {
        currentExplode = targetExplode
        currentCamPos.copy(targetCamPos)
        currentCamTarget.copy(targetCamTarget)
        currentZoom = targetZoom
        const c = applyPositions(currentExplode)
        renderOnce(c, 0)
      } else {
        ensureLoopState()
      }
    },
    setExploded(exploded: boolean) {
      targetExplode = exploded ? 1 : 0
      if (opts.reducedMotion) {
        currentExplode = targetExplode
        const c = applyPositions(currentExplode)
        renderOnce(c, 0)
      } else {
        ensureLoopState()
      }
    },
    selectAssembly(id: AssemblyId | null) {
      selectedId = id
      for (const node of nodes.values()) {
        node.primaryMesh.material =
          node.id === selectedId
            ? highlightMat
            : node.isHousing
              ? housingMat
              : baseBlockMat
      }
      const c = applyPositions(currentExplode)
      const stepIdx = Math.min(
        model.tokenPath.length - 1,
        Math.floor(tokenProgress * model.tokenPath.length)
      )
      renderOnce(c, stepIdx)
    },
    dispose() {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      io?.disconnect()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)

      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.LineSegments
        ) {
          if (obj.geometry) geometries.add(obj.geometry)
          const m = obj.material
          if (Array.isArray(m)) m.forEach((item) => materials.add(item))
          else if (m) materials.add(m)
        }
      })
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      gradientMap.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }

  return api
}
