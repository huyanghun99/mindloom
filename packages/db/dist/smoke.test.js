import { describe, expect, it } from 'vitest';
import { users, workspaces, spaces, pages, documentChunks, jobs } from './schema';
describe('@mindloom/db schema smoke', () => {
    it('exports core table definitions', () => {
        expect(users).toBeDefined();
        expect(workspaces).toBeDefined();
        expect(spaces).toBeDefined();
        expect(pages).toBeDefined();
        expect(documentChunks).toBeDefined();
        expect(jobs).toBeDefined();
    });
});
