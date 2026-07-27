export type TextChunk = {
  content: string;
  position: number;
  tokenCount: number;
};

export function chunkText(
  value: string,
  targetCharacters = 1_200,
  overlapCharacters = 180,
): TextChunk[] {
  const clean = value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];

  const blocks = clean
    .split(/\n\n+/)
    .flatMap((block) => block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [block])
    .map((block) => block.trim())
    .filter(Boolean);

  const output: TextChunk[] = [];
  let current = "";
  for (const block of blocks) {
    if (current && `${current} ${block}`.length > targetCharacters) {
      output.push({
        content: current,
        position: output.length,
        tokenCount: Math.ceil(current.length / 4),
      });
      current = `${current.slice(-overlapCharacters)} ${block}`.trim();
    } else {
      current = current ? `${current} ${block}` : block;
    }
  }
  if (current.length >= 40) {
    output.push({
      content: current,
      position: output.length,
      tokenCount: Math.ceil(current.length / 4),
    });
  }
  return output;
}
