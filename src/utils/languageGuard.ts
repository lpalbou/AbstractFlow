/**
 * Conservative language detection used to enforce the authoring assistant's
 * language contract at the boundary.
 *
 * Why this exists: a full context audit (2026-06-10) proved the production
 * planner model can reply in the host country's language even when the entire
 * payload that reaches it — system prompt, user request, conversation, graph
 * state, 157k chars total — contains zero text in that language, at
 * temperature 0, with explicit language rules in the prompt. Prompt-side
 * instructions are therefore insufficient; the reply language must be
 * verified after each cycle and corrected with a retry when it drifts.
 *
 * Design: detection is deliberately conservative. It only returns a confident
 * code when the evidence is strong (clear stopword margin for Latin-script
 * languages, dominant script share otherwise), and a mismatch is reported
 * only when BOTH texts are confidently detected with different codes. Short
 * or ambiguous text abstains, so the guard never burns retries on noise.
 */

export interface LanguageDetection {
  /** ISO 639-1 code, or '' when unknown/ambiguous. */
  code: string;
  confident: boolean;
}

/**
 * Latin-script stopword profiles. Tokens must be whole words; overlapping
 * stopwords across languages are fine because the decision rule requires a
 * clear margin between the best and second-best language before trusting the
 * result. Single-letter tokens are excluded (too noisy).
 */
const STOPWORD_PROFILES: Record<string, readonly string[]> = {
  en: ['the', 'and', 'is', 'are', 'to', 'of', 'with', 'for', 'that', 'this', 'be', 'on', 'it', 'you', 'will', 'each', 'when', 'must', 'have', 'not', 'between', 'before', 'there', 'would', 'should'],
  fr: ['le', 'la', 'les', 'des', 'une', 'du', 'est', 'sont', 'pour', 'avec', 'que', 'qui', 'dans', 'sur', 'vous', 'nous', 'ce', 'cette', 'et', 'ou', 'pas', 'plus', 'tous', 'chaque', 'entre', 'avant', 'doit', 'être', 'aux', 'comprend', 'leur'],
  es: ['el', 'los', 'las', 'una', 'es', 'son', 'para', 'con', 'que', 'en', 'por', 'del', 'se', 'un', 'este', 'esta', 'cada', 'cuando', 'más', 'debe', 'entre', 'antes', 'hay', 'todos'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'für', 'mit', 'dass', 'ein', 'eine', 'auf', 'im', 'zu', 'von', 'wenn', 'jede', 'muss', 'werden', 'nicht', 'zwischen', 'vor', 'einen', 'dem'],
  it: ['il', 'gli', 'una', 'è', 'sono', 'per', 'con', 'che', 'del', 'della', 'un', 'questo', 'questa', 'ogni', 'quando', 'più', 'deve', 'tra', 'prima', 'tutti', 'nel', 'alla'],
  pt: ['os', 'as', 'uma', 'é', 'são', 'para', 'com', 'que', 'em', 'do', 'da', 'um', 'este', 'esta', 'cada', 'quando', 'mais', 'deve', 'entre', 'antes', 'todos', 'não', 'pelo'],
  nl: ['de', 'het', 'een', 'en', 'is', 'zijn', 'voor', 'met', 'dat', 'dit', 'je', 'op', 'van', 'als', 'elke', 'moet', 'worden', 'niet', 'tussen', 'voordat', 'alle', 'hebben'],
};

/** Non-Latin script ranges; a dominant script is a high-confidence signal. */
const SCRIPT_RANGES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'ja', pattern: /[\u3040-\u30ff]/g }, // kana before Han: Japanese text mixes both
  { code: 'zh', pattern: /[\u4e00-\u9fff]/g },
  { code: 'ko', pattern: /[\uac00-\ud7af]/g },
  { code: 'ru', pattern: /[\u0400-\u04ff]/g },
  { code: 'ar', pattern: /[\u0600-\u06ff]/g },
  { code: 'el', pattern: /[\u0370-\u03ff]/g },
  { code: 'he', pattern: /[\u0590-\u05ff]/g },
  { code: 'hi', pattern: /[\u0900-\u097f]/g },
  { code: 'th', pattern: /[\u0e00-\u0e7f]/g },
];

const MIN_STOPWORD_HITS = 4;
const STOPWORD_MARGIN = 1.5;
const MIN_SCRIPT_SHARE = 0.3;

export function detectLanguage(text: string): LanguageDetection {
  const cleaned = typeof text === 'string' ? text : '';
  if (!cleaned.trim()) return { code: '', confident: false };

  const letters = cleaned.match(/\p{L}/gu) || [];
  if (letters.length < 12) return { code: '', confident: false };

  for (const { code, pattern } of SCRIPT_RANGES) {
    const hits = cleaned.match(pattern)?.length || 0;
    if (hits / letters.length >= MIN_SCRIPT_SHARE) return { code, confident: true };
  }

  const tokens = cleaned
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length >= 2);
  if (tokens.length < 6) return { code: '', confident: false };

  const scores = Object.entries(STOPWORD_PROFILES).map(([code, words]) => {
    const wordSet = new Set(words);
    let count = 0;
    for (const token of tokens) {
      if (wordSet.has(token)) count += 1;
    }
    return { code, count };
  });
  scores.sort((a, b) => b.count - a.count);
  const [best, runnerUp] = scores;
  if (best.count >= MIN_STOPWORD_HITS && best.count >= runnerUp.count * STOPWORD_MARGIN) {
    return { code: best.code, confident: true };
  }
  return { code: best.count > 0 ? best.code : '', confident: false };
}

export interface LanguageMismatch {
  mismatch: boolean;
  requestLang: string;
  replyLang: string;
}

/**
 * A mismatch is reported only when both texts are confidently detected and
 * the codes differ. Anything ambiguous abstains (mismatch=false).
 */
export function replyLanguageMismatch(requestText: string, replyText: string): LanguageMismatch {
  const request = detectLanguage(requestText);
  const reply = detectLanguage(replyText);
  return {
    mismatch: request.confident && reply.confident && request.code !== reply.code,
    requestLang: request.code,
    replyLang: reply.code,
  };
}
