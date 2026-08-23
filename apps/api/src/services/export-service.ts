import type { StoryService } from './story-service.js';
import type { NodeService } from './node-service.js';
import type { BranchService } from './branch-service.js';

/**
 * Exports a single branch as a standalone Markdown story. Only the selected
 * branch's narrative path is included; alternative branches are excluded.
 */
export class ExportService {
  constructor(
    private stories: StoryService,
    private branches: BranchService,
    private nodes: NodeService,
  ) {}

  async exportBranchMarkdown(storyId: string, branchId: string): Promise<string> {
    const [story, branch, nodes] = await Promise.all([
      this.stories.get(storyId),
      this.branches.get(branchId),
      this.nodes.listByBranch(branchId),
    ]);

    const lines: string[] = [];
    lines.push(`# ${story.title}`);
    if (story.description) lines.push('', `> ${story.description}`);
    lines.push('', `*Branch: ${branch.name}*`, '');

    const withContent = nodes.filter((n) => n.content.trim().length > 0);

    // Group by chapter (in branch order). Nodes without a chapter roll into
    // the most recent chapter group, or a default section if none exist yet.
    let currentChapter: { title: string; nodes: typeof nodes } = {
      title: 'Chapter 1',
      nodes: [],
    };
    const sections: Array<{ title: string; nodes: typeof nodes }> = [currentChapter];

    for (const node of withContent) {
      if (node.chapterTitle && node.chapterTitle !== currentChapter.title) {
        currentChapter = { title: node.chapterTitle, nodes: [] };
        sections.push(currentChapter);
      }
      if (node.nodeType !== 'CHAPTER_START') {
        currentChapter.nodes.push(node);
      } else {
        currentChapter.nodes.push(node);
      }
    }

    sections.forEach((section, idx) => {
      if (section.nodes.length === 0 && sections.length > 1 && idx > 0) return;
      lines.push('', `## ${section.title}`, '');
      for (const node of section.nodes) {
        lines.push(node.content.trim(), '');
      }
    });

    return lines.join('\n');
  }
}
