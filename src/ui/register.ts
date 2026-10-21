/**
 * Side-effect aggregator: every feature registers its panels / docks / dialogs / canvas plugins from its OWN directory.
 * Imported once by main.tsx. Keep this file to one import per owner so parallel workers never edit the same lines.
 */
import './panels/library';
import './panels/properties';
import './panels/issues';
import './dialogs/content';
import '@/editor/tools';
