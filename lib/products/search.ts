export function productSearchFilter(search: string): string {
  const pattern = JSON.stringify(`%${search.replace(/[\\%_]/g, "\\$&")}%`)
  return `name.ilike.${pattern},sku.ilike.${pattern}`
}
