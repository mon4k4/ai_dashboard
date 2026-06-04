import fs from 'fs';
import path from 'path';

async function testExport() {
  const projects = JSON.parse(fs.readFileSync('data/projects.json', 'utf8'));
  const tasks = JSON.parse(fs.readFileSync('data/tasks.json', 'utf8'));
  const members = JSON.parse(fs.readFileSync('data/members.json', 'utf8'));

  const req = await fetch('http://localhost:5173/api/wbs/export-excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      projectId: 'proj-1779159400698',
      projects,
      tasks,
      members
    })
  });
  
  if (!req.ok) {
    console.error('Error Status:', req.status);
    console.error('Error Text:', await req.text());
    return;
  }
  const data = await req.json();
  console.log('Exported:', data.filePath);
}
testExport();
