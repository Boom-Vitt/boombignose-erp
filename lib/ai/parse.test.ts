import { describe, it, expect } from "vitest"

import { parseActionItems } from "@/lib/ai/parse"

describe("parseActionItems", () => {
  it("extracts dash bullets", () => {
    const text = "- Call the client\n- Send the proposal\n- Schedule kickoff"
    expect(parseActionItems(text)).toEqual([
      { title: "Call the client" },
      { title: "Send the proposal" },
      { title: "Schedule kickoff" },
    ])
  })

  it("extracts asterisk and bullet-character bullets", () => {
    const text = "* First thing\n• Second thing"
    expect(parseActionItems(text)).toEqual([
      { title: "First thing" },
      { title: "Second thing" },
    ])
  })

  it("extracts numbered lists with . and ) separators", () => {
    const text = "1. Draft the quote\n2) Follow up Monday\n3. Confirm budget"
    expect(parseActionItems(text)).toEqual([
      { title: "Draft the quote" },
      { title: "Follow up Monday" },
      { title: "Confirm budget" },
    ])
  })

  it("strips checkbox markers left after the bullet", () => {
    const text = "- [ ] Call client\n- [x] Send invoice"
    expect(parseActionItems(text)).toEqual([
      { title: "Call client" },
      { title: "Send invoice" },
    ])
  })

  it("skips blank lines and header/label lines", () => {
    const text =
      "Action items:\n\n- Prepare the deck\n\n# Notes\n- Book the room\n"
    expect(parseActionItems(text)).toEqual([
      { title: "Prepare the deck" },
      { title: "Book the room" },
    ])
  })

  it("returns an empty array for prose with no bullets", () => {
    const text =
      "The meeting went well. The client is interested and will decide next week."
    expect(parseActionItems(text)).toEqual([])
  })

  it("returns an empty array for empty input", () => {
    expect(parseActionItems("")).toEqual([])
    expect(parseActionItems("   \n  \n")).toEqual([])
  })

  it("treats a '(none)' placeholder bullet as no action items", () => {
    expect(parseActionItems("Action items:\n- (none)")).toEqual([])
    expect(parseActionItems("- None")).toEqual([])
    expect(parseActionItems("1. none.")).toEqual([])
  })

  it("ignores a summary paragraph but keeps the trailing list", () => {
    const text = [
      "Summary: strong intro call, budget confirmed.",
      "",
      "Action items:",
      "- Send SOW by Friday",
      "- Intro the delivery lead",
    ].join("\n")
    expect(parseActionItems(text)).toEqual([
      { title: "Send SOW by Friday" },
      { title: "Intro the delivery lead" },
    ])
  })
})
