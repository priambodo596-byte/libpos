import { createDocument, createNodeFactory, createSequentialIdGenerator, type DocumentJSON } from "../src/index";

export const NOW = "2026-01-01T00:00:00.000Z";

/** A deterministic document that exercises every built-in block, inline and mark. */
export function makeDoc(): DocumentJSON {
  const ids = createSequentialIdGenerator();
  const f = createNodeFactory(ids);
  return createDocument({
    id: "doc-1",
    title: "Sample",
    language: "id",
    now: NOW,
    ids,
    content: [
      f.heading(1, "Title"),
      f.paragraph([f.text("Hello "), f.text("world", [{ type: "bold" }, { type: "italic" }]), f.placeholder("customer.name", "Customer")]),
      f.bulletList(["one", "two"]),
      f.orderedList(["first", "second"], 3),
      f.table([
        ["a", "b"],
        ["c", "d"],
      ]),
      f.image("img.png", { alt: "An image", width: 100, height: 50 }),
      f.pageBreak(),
      f.horizontalRule(),
    ],
  });
}
