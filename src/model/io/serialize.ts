import { nowIso } from '../clock';
import { PROJECT_FORMAT, SCHEMA_VERSION, type Project, type ProjectFile } from '../types';

export const APP_INFO = { name: 'SchemaCanvas', version: '0.1.0' } as const;

/** The `ProjectFile` envelope as an object (what IndexedDB records and `serializeProject` both describe). */
export function toProjectFile(project: Project, savedAt: string = nowIso()): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    savedAt,
    app: { ...APP_INFO },
    project: project.schemaVersion === SCHEMA_VERSION ? project : { ...project, schemaVersion: SCHEMA_VERSION },
  };
}

/** Pretty-printed (2 spaces) so files diff well and stay hand-inspectable. Key order follows the object, not sorted. */
export function serializeProject(project: Project, savedAt?: string): string {
  return JSON.stringify(toProjectFile(project, savedAt), null, 2);
}
