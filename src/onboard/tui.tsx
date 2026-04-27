import React, { useState, useLayoutEffect, useRef } from 'react';
import { Box, Text, useStdin } from 'ink';
import type { Question } from './schema.js';

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
