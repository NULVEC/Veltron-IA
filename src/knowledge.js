const STOP_WORDS = new Set([
  "para", "como", "pero", "esta", "este", "esto", "desde", "hasta", "sobre",
  "entre", "donde", "cuando", "porque", "tambien", "tiene", "tienen", "with",
  "that", "this", "from", "what", "when", "where", "your", "the", "and", "una",
  "uno", "unos", "unas", "del", "las", "los", "que", "por", "con", "sin",
]);

function normalize(text) {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function terms(text) {
  return [...new Set(normalize(text).match(/[a-z0-9]{3,}/g) || [])]
    .filter((term) => !STOP_WORDS.has(term));
}

function chunks(content) {
  const paragraphs = content.replace(/\r/g, "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const result = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 900) result.push(paragraph);
    else for (let index = 0; index < paragraph.length; index += 800) result.push(paragraph.slice(index, index + 900));
  }
  return result;
}

export function retrieveKnowledge(documents = [], query, limit = 4) {
  const queryTerms = terms(query);
  if (!queryTerms.length || !documents.length) return [];
  const matches = [];
  for (const document of documents) {
    for (const content of chunks(document.content)) {
      const normalized = normalize(content);
      const score = queryTerms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0);
      if (score) matches.push({ name: document.name, content, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.content.length - b.content.length).slice(0, limit);
}

export function formatKnowledge(matches) {
  if (!matches.length) return "";
  return matches.map((match) => `[Archivo: ${match.name}]\n${match.content}`).join("\n\n").slice(0, 4_500);
}
