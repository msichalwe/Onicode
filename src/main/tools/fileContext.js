/**
 * FileContextTracker — tracks which files the AI has read, edited, created, deleted.
 */

const { logger } = require('../logger');

class FileContextTracker {
    constructor() {
        this.readFiles = new Map();
        this.modifiedFiles = new Map();
        this.createdFiles = new Set();
        this.deletedFiles = new Set();
        this.changelog = [];
        this._accessCount = new Map();
    }

    trackRead(filePath, content) {
        const lines = content.split('\n').length;
        this.readFiles.set(filePath, {
            lines,
            lastRead: Date.now(),
            size: content.length,
        });
        this._accessCount.set(filePath, (this._accessCount.get(filePath) || 0) + 1);
        logger.debug('file-ctx', `Read: ${filePath} (${lines} lines)`);
    }

    trackEdit(filePath, oldStr, newStr) {
        if (!this.modifiedFiles.has(filePath)) {
            this.modifiedFiles.set(filePath, { edits: [], linesAdded: 0, linesDeleted: 0 });
        }
        const entry = this.modifiedFiles.get(filePath);
        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        const added = Math.max(0, newLines - oldLines);
        const deleted = Math.max(0, oldLines - newLines);
        entry.linesAdded += added;
        entry.linesDeleted += deleted;
        entry.edits.push({
            oldStr: oldStr.slice(0, 100),
            newStr: newStr.slice(0, 100),
            linesAdded: added,
            linesDeleted: deleted,
            timestamp: Date.now(),
        });
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'edit',
            path: filePath,
            detail: `+${added} -${deleted} lines`,
        });
        logger.fileChange('edit', filePath, { added, deleted });
    }

    trackCreate(filePath, content) {
        this.createdFiles.add(filePath);
        const lines = content ? content.split('\n').length : 0;
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'create',
            path: filePath,
            detail: `${lines} lines`,
        });
        logger.fileChange('create', filePath, { lines });
    }

    trackDelete(filePath) {
        this.deletedFiles.add(filePath);
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'delete',
            path: filePath,
            detail: '',
        });
        logger.fileChange('delete', filePath);
    }

    getSummary() {
        let totalAdded = 0;
        let totalDeleted = 0;
        for (const entry of this.modifiedFiles.values()) {
            totalAdded += entry.linesAdded;
            totalDeleted += entry.linesDeleted;
        }
        return {
            filesRead: this.readFiles.size,
            filesModified: this.modifiedFiles.size,
            filesCreated: this.createdFiles.size,
            filesDeleted: this.deletedFiles.size,
            totalLinesAdded: totalAdded,
            totalLinesDeleted: totalDeleted,
            readPaths: [...this.readFiles.keys()],
            modifiedPaths: [...this.modifiedFiles.keys()],
            createdPaths: [...this.createdFiles],
            deletedPaths: [...this.deletedFiles],
        };
    }

    getChangelog() {
        return this.changelog.slice(-100);
    }

    generateChangelogMarkdown() {
        if (this.changelog.length === 0) return '(no changes yet)';
        const lines = [];
        const created = this.changelog.filter(c => c.action === 'create');
        const edited = this.changelog.filter(c => c.action === 'edit');
        const deleted = this.changelog.filter(c => c.action === 'delete');
        if (created.length > 0) {
            lines.push('### Created');
            [...new Set(created.map(c => c.path))].forEach(p => lines.push(`- \`${p}\``));
        }
        if (edited.length > 0) {
            lines.push('### Modified');
            [...new Set(edited.map(c => c.path))].forEach(p => {
                const entry = this.modifiedFiles.get(p);
                const detail = entry ? ` (+${entry.linesAdded} -${entry.linesDeleted})` : '';
                lines.push(`- \`${p}\`${detail}`);
            });
        }
        if (deleted.length > 0) {
            lines.push('### Deleted');
            [...new Set(deleted.map(c => c.path))].forEach(p => lines.push(`- \`${p}\``));
        }
        return lines.join('\n');
    }

    getHotFiles(limit = 10) {
        const now = Date.now();
        const scored = [];
        for (const [filePath, count] of this._accessCount) {
            const readInfo = this.readFiles.get(filePath);
            const recencyBonus = readInfo ? Math.max(0, 1 - ((now - readInfo.lastRead) / 600000)) : 0;
            const score = (count * 2) + recencyBonus;
            scored.push({ filePath, score, count, lastRead: readInfo?.lastRead || 0 });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    reset() {
        this.readFiles.clear();
        this.modifiedFiles.clear();
        this.createdFiles.clear();
        this.deletedFiles.clear();
        this.changelog = [];
        this._accessCount.clear();
    }
}

module.exports = { FileContextTracker };
