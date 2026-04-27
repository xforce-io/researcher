import React, { useState, useLayoutEffect, useRef } from 'react';
import { Box, Text, useStdin } from 'ink';
import type { Question } from './schema.js';
import { OnboardingState, type SerializedAnswer } from './state.js';

export interface QuestionScreenProps {
  question: Question;
  onSubmit: (text: string) => void;
  onSkip: () => void;
}

// Recognises the small set of control bytes QuestionScreen needs (Enter,
// Esc, Backspace). Everything else is treated as either a printable char
// or filtered out (escape-prefixed multi-byte sequences like arrow keys).
function detectKey(raw: string) {
  return {
    return: raw === '\r' || raw === '\n',
    escape: raw === '\x1b' || raw === '\x1b\x1b',
    backspace: raw === '\b' || raw === '\x7f',
    delete: raw === '\x7f',
  };
}

export function QuestionScreen(props: QuestionScreenProps): React.JSX.Element {
  const { question: q, onSubmit, onSkip } = props;
  const [text, setText] = useState('');
  // Keep a ref so the data handler always sees the latest text without
  // re-subscribing on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;

  const { stdin, setRawMode } = useStdin();

  useLayoutEffect(() => {
    if (!stdin) return;
    setRawMode(true);

    const handler = (chunk: Buffer | string) => {
      const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const key = detectKey(raw);

      if (key.return) {
        const trimmed = textRef.current.trim();
        if (trimmed.length > 0) onSubmit(trimmed);
        return;
      }
      if (key.escape) {
        if (!q.required) onSkip();
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }
      // Filter out other control/escape sequences (starts with \x1b)
      if (raw.startsWith('\x1b')) return;
      // Filter out lone control characters (< 0x20)
      if (raw.length === 1 && raw.charCodeAt(0) < 0x20) return;

      setText((t) => t + raw);
    };

    stdin.on('data', handler);
    return () => {
      stdin.off('data', handler);
      setRawMode(false);
    };
  }, [stdin, setRawMode, q.required, onSubmit, onSkip]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{q.id} — {q.fieldId}{q.required ? '' : ' (optional)'}</Text>
      <Box marginTop={1}><Text>{q.question}</Text></Box>
      {q.style && <Box marginTop={1}><Text dimColor>Style: {q.style}</Text></Box>}
      {q.examplesGood.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">Examples (good):</Text>
          {q.examplesGood.map((e, i) => <Text key={i} color="green">  • {e}</Text>)}
        </Box>
      )}
      {q.examplesBad.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">Examples (bad):</Text>
          {q.examplesBad.map((e, i) => <Text key={i} color="red">  • {e}</Text>)}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>{'> '}</Text>
        <Text>{text}</Text>
        <Text inverse> </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Enter to submit{q.required ? '' : ' · Esc to skip'}
        </Text>
      </Box>
    </Box>
  );
}

export interface DiffReviewProps {
  before: { projectYaml: string; thesisMd: string };
  after: { projectYaml: string; thesisMd: string };
  onAccept: () => void;
  onReanswer: () => void;
  onAbort: () => void;
}

export function DiffReview(props: DiffReviewProps): React.JSX.Element {
  const { stdin, setRawMode } = useStdin();

  useLayoutEffect(() => {
    if (!stdin) return;
    setRawMode(true);
    const handler = (chunk: Buffer | string) => {
      const raw = chunk.toString();
      if (raw === 'a') props.onAccept();
      else if (raw === 'r') props.onReanswer();
      else if (raw === 'x') props.onAbort();
    };
    stdin.on('data', handler);
    return () => {
      stdin.off('data', handler);
      setRawMode(false);
    };
  }, [stdin, setRawMode, props.onAccept, props.onReanswer, props.onAbort]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Review rewritten files</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">─── project.yaml (before → after) ───</Text>
        <Text dimColor>{props.before.projectYaml}</Text>
        <Text>{props.after.projectYaml}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">─── thesis.md (before → after) ───</Text>
        <Text dimColor>{props.before.thesisMd}</Text>
        <Text>{props.after.thesisMd}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[a] accept · [r] re-answer · [x] abort</Text>
      </Box>
    </Box>
  );
}

export interface AppProps {
  questions: Question[];
  onAllAnswered: (answers: SerializedAnswer[]) => Promise<{
    before: { projectYaml: string; thesisMd: string };
    after: { projectYaml: string; thesisMd: string };
  }>;
  onCommit: (
    rewritten: { projectYaml: string; thesisMd: string },
    topicOneline: string
  ) => void;
  onAbort: () => void;
}

type Phase =
  | { kind: 'asking'; idx: number }
  | { kind: 'rewriting' }
  | { kind: 'reviewing'; before: { projectYaml: string; thesisMd: string }; after: { projectYaml: string; thesisMd: string } }
  | { kind: 'errored'; error: string };

export function App(props: AppProps): React.JSX.Element {
  const stateRef = useRef(new OnboardingState(props.questions));
  const [phase, setPhase] = useState<Phase>({ kind: 'asking', idx: 0 });

  const advanceFrom = (idx: number): void => {
    if (idx < props.questions.length - 1) {
      setPhase({ kind: 'asking', idx: idx + 1 });
      return;
    }
    setPhase({ kind: 'rewriting' });
    void (async () => {
      try {
        const { before, after } = await props.onAllAnswered(stateRef.current.serialize());
        setPhase({ kind: 'reviewing', before, after });
      } catch (e) {
        setPhase({ kind: 'errored', error: (e as Error).message });
      }
    })();
  };

  if (phase.kind === 'asking') {
    const q = props.questions[phase.idx];
    return (
      <QuestionScreen
        question={q}
        onSubmit={(text) => {
          stateRef.current.answer(q.id, text);
          advanceFrom(phase.idx);
        }}
        onSkip={() => {
          stateRef.current.skip(q.id);
          advanceFrom(phase.idx);
        }}
      />
    );
  }

  if (phase.kind === 'rewriting') {
    return (
      <Box paddingX={1}>
        <Text>Rewriting answers via agent runtime…</Text>
      </Box>
    );
  }

  if (phase.kind === 'errored') {
    return (
      <Box paddingX={1} flexDirection="column">
        <Text color="red">Rewrite failed: {phase.error}</Text>
        <Text dimColor>Raw answers preserved in /tmp; re-run `researcher onboard`.</Text>
      </Box>
    );
  }

  // reviewing
  const a1 = stateRef.current.getAnswer('Q1');
  const topicOneline = a1?.kind === 'text' ? a1.text : '';
  return (
    <DiffReview
      before={phase.before}
      after={phase.after}
      onAccept={() => props.onCommit(phase.after, topicOneline)}
      onReanswer={() => setPhase({ kind: 'asking', idx: 0 })}
      onAbort={() => props.onAbort()}
    />
  );
}
