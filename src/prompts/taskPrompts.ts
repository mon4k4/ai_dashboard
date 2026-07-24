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

export const buildProjectMatchingPrompt = (title: string, content: string, projects: any[], members: any[]) => {
  const projectsListStr = projects.map(p => {
    const memberNames = (p.stakeholders || []).map((id: string) => {
      const m = members.find(mem => mem.id === id);
      return m ? m.name : id;
    }).join(', ');
    return `- ID: ${p.id}\n  Name: ${p.name}\n  Summary: ${p.summary}\n  Stakeholders: ${memberNames}`;
  }).join('\n\n');

  return `以下の会議のタイトルと会議内容（または参加者情報）を分析し、現在登録されているプロジェクト一覧から、最も関連性が高い適切なプロジェクトを1つ特定してください。

【会議のタイトル】
${title}

【会議内容・参加者情報】
${content.slice(0, 3000)}

【登録されているプロジェクト一覧】
${projectsListStr}

最も適切なプロジェクトのIDを判定し、以下のJSONフォーマットで返却してください。JSON以外の文章や説明は一切含めないでください。
確信を持って特定できない場合、またはどれにも該当しない場合は、projectIdを"unknown"にしてください。

【出力フォーマット】
{
  "projectId": "判定したプロジェクトID、もしくは特定できない場合は \\"unknown\\""
}`;
};

export const buildSmartTaskExtractionPrompt = (
  content: string,
  activeTasks: any[],
  groupTasks: any[],
  members: any[]
) => {
  const activeTasksStr = activeTasks.map(t => {
    return `- Task ID: ${t.id}\n  Title: ${t.title}\n  Details: ${t.details || 'なし'}\n  Assignee: ${t.assignee || '未割り当て'}\n  Status: ${t.status}\n  Action Result (対応結果): ${t.actionResult || 'なし'}`;
  }).join('\n\n');

  const groupsStr = groupTasks.map(g => {
    return `- Group ID: ${g.id}\n  Title: ${g.title}`;
  }).join('\n');

  const membersStr = members.map(m => `- ${m.name}`).join('\n');

  return `以下の会議内容から、決定されたタスク、更新すべき既存タスク、対応結果（進捗や状況の報告）を抽出・判定してください。

【会議内容】
${content}

【既存のプロジェクト所属アクティブタスク一覧】
${activeTasksStr || 'なし'}

【プロジェクトの親グループ（WBS用）一覧】
${groupsStr || 'なし'}

【メンバー一覧（担当者割り当て用）】
${membersStr}

【タスク抽出・マッチング指示】
1. 議事録内で、既存のタスク一覧に含まれるタスクについて、現在の状況、行われた対応、進捗などの言及があった場合：
   - その既存タスクの「更新（"type": "update"）」として判定してください。
   - 議事録から読み取れる最新の具体的な進捗や対応内容（今回の会議で新しく報告された内容）のみを「actionResult（対応結果）」に記述してください。既存の対応結果をここに含めたり、自分でマージしたりしないでください。
   - 進捗や発言内容に基づいて、status（"todo", "in-progress", "done"）および progress（0〜100）を更新してください。完了したことが明らかな場合は done、進捗中なら in-progress に設定してください。
   - タスクの背景情報や追加情報がある場合は、今回新しく判明した追加・変更部分のみを details（詳細情報）に記述してください。既存の詳細情報をここに含めたり、自分でマージしたりしないでください（システム側で自動的に追記マージされます）。

2. 議事録内で、既存のタスク一覧に該当しない、新しく決定されたタスク（Todo）がある場合：
   - 「新規タスク（"type": "new"）」として抽出してください。
   - statusは "todo" とし、progressは 0 としてください。
   - title、details（詳細）、assignee（担当者名。メンバー一覧に該当する人がいればその名前）を設定してください。
   - 新規タスクが【プロジェクトの親グループ一覧】のいずれかのグループの子タスクとして入れ子（ネスト）にできる場合は、最も適切な親グループのIDを parentId に設定してください。どの親グループにも該当しない場合は null にしてください。
   - もし新規タスク自身が一番上の親グループ（大項目カテゴリなど）となるべき場合は、必ずタスク名を【】で囲んでください（例：【新しいカテゴリ】）。
   - 既存のタスク一覧の中で、この新規タスクが依存している（このタスクの前提となる、または関連して次に進めるべき）タスクがある場合、該当するタスクのIDを配列で dependencies に含めてください。**必ず【既存のプロジェクト所属アクティブタスク一覧】に記載されているTask IDの中から選択してください。自由なテキスト記述や存在しないIDの指定は絶対に禁止です。**関連がない場合は空配列 [] にしてください。

出力は必ず以下のJSON配列フォーマットにしてください。JSON以外のテキストは一切含めないでください。

【出力フォーマット】
[
  {
    "type": "new",
    "title": "新規タスク名",
    "details": "具体的な詳細情報や背景",
    "assignee": "担当者名",
    "status": "todo",
    "parentId": "関連する親グループID（なければnull）",
    "dependencies": ["依存・関連する既存タスクのID（必ず一覧にあるIDのみ。なければ空配列）"]
  },
  {
    "type": "update",
    "id": "既存タスクのTask ID",
    "details": "今回新しく追加・変更された詳細情報（既存の内容は含めない）",
    "actionResult": "今回の会議で新しく報告された具体的な対応結果・現在の状況（既存の対応結果は含めない）",
    "status": "todo / in-progress / done のいずれか最新のステータス",
    "progress": 0-100の範囲の最新進捗率
  }
]`;
};

export const buildTaskEdgeGenerationPrompt = (tasks: any[]) => {
  const tasksListStr = tasks.map(t => {
    return `- ID: ${t.id}\n  Title: ${t.title}\n  Details: ${t.details || 'なし'}\n  Status: ${t.status}`;
  }).join('\n\n');

  return `以下のプロジェクト内タスク一覧を分析し、タスク間の依存関係や先後関係（どのタスクが完了してから次のタスクを進めるべきか、あるいは論理的に繋がっているか）を合理的に推論して、タスク間の接続（エッジ）を提案してください。
提案は必ず以下のJSON配列フォーマットで返却してください。JSON以外のテキストや説明は一切出力しないでください。

【タスク一覧】
${tasksListStr}

【提案上のルール】
1. 無関係なタスク同士を無理に繋ぐ必要はありません。真に関連性が高いものだけを提案してください。
2. 循環参照（A -> B -> A など）が発生しないようにしてください。
3. sourceは先行するタスク（または前提となるタスク）、targetは後行するタスク（または関連して次に進めるべきタスク）に設定してください。

【出力フォーマット】
[
  {
    "source": "先行タスクのID",
    "target": "後行タスクのID",
    "reason": "関連性や依存関係の簡単な理由"
  }
]`;
};

