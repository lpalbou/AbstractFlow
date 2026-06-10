import { describe, expect, it } from 'vitest';
import { detectLanguage, replyLanguageMismatch } from './languageGuard';

// Real texts from the 2026-06-10 ledger audit: the model replied in French to
// a fully English 144k-char context at temperature 0. The guard must catch
// exactly this drift.
const ENGLISH_REQUEST =
  'I would like you to create a workflow to determine (a) the number of AIs in a discussion and (b) the maximum number of discussion cycles between these AIs before concluding and providing an answer. There must be a genuine discussion, research, and deepening of ideas.';

const FRENCH_REPLY =
  "Le workflow de discussion multi-IA est maintenant complet. Il comprend : (1) des entrées pour le sujet, le nombre d'IA et le nombre maximum de cycles, (2) une boucle externe pour les cycles de discussion, (3) une boucle interne pour les participants IA avec des modèles distincts, (4) une gestion d'état via des variables pour accumuler le transcript.";

const ENGLISH_REPLY =
  'The Multi-AI Discussion Workflow is complete. The graph contains inputs for the topic, the number of AIs and the maximum cycles, an outer loop for discussion cycles, an inner loop for participants, and a final synthesis call after all cycles.';

const FRENCH_REQUEST =
  "je voudrais que tu créés un workflow qui permette de déterminer le nombre d'IA dans une discussion et le nombre maximal de cycles de discussions entre ces IA avant de conclure et fournir une réponse à l'utilisateur.";

describe('detectLanguage', () => {
  it('detects English and French confidently on real planner texts', () => {
    expect(detectLanguage(ENGLISH_REQUEST)).toEqual({ code: 'en', confident: true });
    expect(detectLanguage(FRENCH_REPLY)).toEqual({ code: 'fr', confident: true });
    expect(detectLanguage(ENGLISH_REPLY)).toEqual({ code: 'en', confident: true });
    expect(detectLanguage(FRENCH_REQUEST)).toEqual({ code: 'fr', confident: true });
  });

  it('detects unaccented French (ledger-style repair replies)', () => {
    const text =
      'Correction des parametres provider et model sur le noeud participant pour laisser les valeurs par defaut du gateway et permettre la selection dynamique du modele dans la boucle des participants.';
    const detected = detectLanguage(text);
    expect(detected.code).toBe('fr');
    expect(detected.confident).toBe(true);
  });

  it('detects non-Latin scripts by dominant script share', () => {
    expect(detectLanguage('请创建一个多人工智能讨论的工作流，包含多个讨论周期和最终总结。')).toEqual({ code: 'zh', confident: true });
    expect(detectLanguage('ワークフローを作成してください。複数のAIが議論し、最終的な回答を出します。')).toEqual({ code: 'ja', confident: true });
    expect(detectLanguage('Создай рабочий процесс для обсуждения между несколькими ИИ с финальным ответом.')).toEqual({ code: 'ru', confident: true });
  });

  it('abstains on short or ambiguous text', () => {
    expect(detectLanguage('').confident).toBe(false);
    expect(detectLanguage('ok').confident).toBe(false);
    expect(detectLanguage('42 cycles, 3 AIs').confident).toBe(false);
    // Technical identifiers without natural-language evidence.
    expect(detectLanguage('set_pin_default llm_call.provider model loop_ais exec-out').confident).toBe(false);
  });
});

describe('replyLanguageMismatch', () => {
  it('flags the exact observed drift: English request, French reply', () => {
    const result = replyLanguageMismatch(ENGLISH_REQUEST, FRENCH_REPLY);
    expect(result).toEqual({ mismatch: true, requestLang: 'en', replyLang: 'fr' });
  });

  it('accepts matched languages in both directions', () => {
    expect(replyLanguageMismatch(ENGLISH_REQUEST, ENGLISH_REPLY).mismatch).toBe(false);
    expect(replyLanguageMismatch(FRENCH_REQUEST, FRENCH_REPLY).mismatch).toBe(false);
  });

  it('abstains when either side is ambiguous', () => {
    expect(replyLanguageMismatch('ok', FRENCH_REPLY).mismatch).toBe(false);
    expect(replyLanguageMismatch(ENGLISH_REQUEST, 'done').mismatch).toBe(false);
  });
});
