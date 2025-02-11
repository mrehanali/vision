import { env } from '../config/env';

// Types for API responses
interface CodeChunkResponse {
  code: string;
  file: string;
}

interface GenerateCodeRequest {
  description: string;
}

export interface GeneratedFile {
  filename: string;
  content: string;
}

interface GenerationResponse {
  files: GeneratedFile[];
  preview_url?: string;
}

export async function generateCodeFromPrompt(
  prompt: string,
  onProgress?: (files: GeneratedFile[]) => void
): Promise<GenerationResponse> {
  const response = await fetch(`${env.apiUrl}/generate-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ description: prompt }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.detail || `Failed to generate code: ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error('No response body received');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let files: Map<string, string> = new Map();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        try {
          const jsonStr = trimmedLine.slice(5).trim(); // Remove 'data:' prefix and whitespace
          if (!jsonStr) continue; // Skip empty data lines
          
          const chunk: CodeChunkResponse = JSON.parse(jsonStr);
          
          // Extract filename from the first line comment if it exists
          let filename = chunk.file;
          const firstLine = chunk.code.split('\n')[0];
          if (firstLine && firstLine.startsWith('//')) {
            filename = firstLine.slice(2).trim();
          } else if (chunk.file === 'typescript') {
            // Skip if we can't determine the filename
            continue;
          }

          // Update or create file content
          const currentContent = files.get(filename) || '';
          // Remove the filename comment from the content
          const content = chunk.code.split('\n').slice(1).join('\n');
          files.set(filename, currentContent + content);

          // Convert Map to array of files for the callback
          const currentFiles: GeneratedFile[] = Array.from(files.entries()).map(
            ([filename, content]) => ({
              filename: filename.replace(/^\//, ''), // Remove leading slash if present
              content
            })
          );

          onProgress?.(currentFiles);
        } catch (error) {
          console.error('Failed to parse chunk:', error, 'Line:', trimmedLine);
          throw new Error('Failed to parse server response');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Convert final Map to array of files for the response
  const finalFiles: GeneratedFile[] = Array.from(files.entries()).map(
    ([filename, content]) => ({
      filename: filename.replace(/^\//, ''), // Remove leading slash if present
      content
    })
  );

  return { files: finalFiles };
}