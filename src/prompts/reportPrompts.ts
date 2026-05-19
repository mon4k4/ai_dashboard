export const buildWeeklyReportPrompt = (minutesText: string, templateText?: string) => {
  const templateInstruction = templateText
    ? `以下のテンプレートのフォーマットに厳密に従って出力してください。\n\n【出力テンプレート】\n${templateText}\n\n`
    : '今週の週報（サマリー、主な進捗、次週の課題）をマークダウン形式で作成してください。\n\n';

  return `以下の今週の複数の会議議事録要約を元に、週報を作成してください。\n${templateInstruction}【議事録要約群】\n${minutesText}`;
};
