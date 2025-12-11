
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Cast process to any to avoid "Property 'cwd' does not exist on type 'Process'" error
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  const envDefines: Record<string, string> = {
    'process.env': '{}'
  };

  // Expose standard API_KEY and API_KEY_1 through API_KEY_10
  const keysToExpose = ['API_KEY'];
  for (let i = 1; i <= 10; i++) {
    keysToExpose.push(`API_KEY_${i}`);
  }
  
  keysToExpose.forEach(key => {
    // Check both VITE_ prefixed (Vercel/Vite default) and plain
    const val = env[key] || env[`VITE_${key}`] || '';
    envDefines[`process.env.${key}`] = JSON.stringify(val);
  });

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
    },
    define: envDefines
  };
});
