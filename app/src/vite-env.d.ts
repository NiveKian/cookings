/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVICE_CURSOS_URL?: string;
  readonly VITE_SERVICE_MATRICULAS_URL?: string;
  readonly VITE_SERVICE_RECEITAS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
