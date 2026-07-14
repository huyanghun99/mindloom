export declare const env: {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    APP_SECRET: string;
    PUBLIC_BASE_URL: string;
    ALLOW_SIGNUP: boolean;
    DATABASE_URL: string;
    EMBEDDING_DIMENSION: number;
    STORAGE_DRIVER: "local" | "s3";
    UPLOAD_DIR: string;
    AI_DRIVER: "mock" | "openai" | "openai-compatible" | "ollama" | "gemini";
    AI_COMPLETION_MODEL: string;
    AI_EMBEDDING_MODEL: string;
    OPENAI_API_URL: string;
    OPENAI_API_KEY: string;
    RAG_RATE_LIMIT_PER_USER_PER_MINUTE: number;
    RAG_RATE_LIMIT_PER_SPACE_PER_MINUTE: number;
};
