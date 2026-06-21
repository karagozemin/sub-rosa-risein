import { Buffer } from "buffer";

const runtime = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtime.Buffer ??= Buffer;
