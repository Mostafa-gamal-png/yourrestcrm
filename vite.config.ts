import vinext from "vinext";
import {defineConfig} from "vite";
export default defineConfig({plugins:[vinext()],resolve:{alias:{"cloudflare:workers":new URL('./portable/runtime.mjs',import.meta.url).pathname}}});
