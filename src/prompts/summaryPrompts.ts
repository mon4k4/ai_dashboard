export const buildSummaryPrompt = (transcript: string) => `以下の会議の文字起こしを要約し、重要な決定事項と議論のポイントをマークダウン形式で簡潔にまとめてください。

【文字起こし】
${transcript}`;
