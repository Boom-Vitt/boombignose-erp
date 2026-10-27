# Roles

## Reference scout

Look at live product sites. Record the URL, the date, and whether the page was read or only noted for style. Say what to borrow: layout, type, color, or motion. Refuse copied assets.

Prompt: "Open the download and home pages. List layout ideas we can rebuild with our own CSS. Do not save their images."

## Art director

Choose one palette and one accent. Reject poster collages, stock scenes, and a second accent on the same page. The logo mark wins if its orange differs from a proposal.

Prompt: "Pick Midnight Local, Paper Trust, or Siam Teal. Justify it in four sentences. Name the single accent hex."

## UI designer

Turn the choice into tokens: color, type scale, spacing, radius, and components. Thai text uses IBM Plex Sans Thai, with Noto Sans Thai, Anuphan, and Sarabun as fallbacks. Latin and numbers use Inter. Checksums use JetBrains Mono.

Prompt: "Write tokens that a static page and the ERP theme can both read. Do not invent components the page does not need."

## Frontend implementer

Apply the tokens to `site/index.html`. Keep the page static. A short script may point the hero button at the visitor's OS. Do not add analytics. ERP edits stay in `app/globals.css` and must not change component behavior.

Prompt: "Implement the section order in the brief. Use our SVG mark. Label every mock as a mock."

## QA and accessibility reviewer

Check contrast of text, muted text, and the accent button. Confirm a visible focus ring, a skip link, and `prefers-reduced-motion`. Read the Thai first. Compare every claim with the repo and the published Release.

Prompt: "Try the page with a keyboard and with motion reduced. List any sentence that overclaims the installer."
