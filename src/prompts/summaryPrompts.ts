export const buildSummaryPrompt = (transcript: string) => `以下の会議の文字起こしを要約し、重要な決定事項と議論のポイントをマークダウン形式で簡潔にまとめてください。
なお、要約内の人名には「さん」や「氏」などの敬称は付けずに（省略して）生成してください。

【文字起こし】
${transcript}`;

