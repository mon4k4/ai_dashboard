export const buildTaskExtractionPrompt = (transcript: string) => `以下の会議の文字起こしから、決定されたタスクと担当者を抽出してください。
出力は必ず以下のJSON配列フォーマットにしてください。JSON以外のテキストは出力しないでください。
[
  {
    "id": "ユニークなID（例: task-1）",
    "title": "タスクの簡潔なタイトル",
    "details": "タスクの具体的な詳細情報や背景",
    "assignee": "担当者名",
    "status": "todo"
  }
]

【文字起こし】
${transcript}`;
