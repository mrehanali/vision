import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PreviewTabs } from './PreviewTabs';
import { CodePreview } from './CodePreview';
import { FileText, Loader, Download, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import JSZip from 'jszip';
import ReactRouterDOM from 'react-router-dom';

interface GeneratedFile {
  filename: string;
  content: string;
}

interface PreviewProps {
  files: GeneratedFile[];
  selectedFile: GeneratedFile | null;
  onFileSelect: (file: GeneratedFile) => void;
  isLoading: boolean;
}

interface DirectoryNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: DirectoryNode[];
  content?: string;
}

function buildDirectoryTree(files: GeneratedFile[]): DirectoryNode[] {
  const root: DirectoryNode[] = [];
  
  files.forEach(file => {
    const parts = file.filename.split('/');
    let currentLevel = root;
    
    parts.forEach((part, index) => {
      const isLastPart = index === parts.length - 1;
      const existingNode = currentLevel.find(node => node.name === part);
      
      if (existingNode) {
        if (!isLastPart) {
          currentLevel = existingNode.children!;
        }
      } else {
        const newNode: DirectoryNode = {
          name: part,
          type: isLastPart ? 'file' : 'directory',
          path: parts.slice(0, index + 1).join('/'),
          children: isLastPart ? undefined : [],
        };
        
        if (isLastPart) {
          newNode.content = file.content;
        }
        
        currentLevel.push(newNode);
        if (!isLastPart) {
          currentLevel = newNode.children!;
        }
      }
    });
  });

  // Sort function to put directories first, then dot files, then regular files
  const sortNodes = (nodes: DirectoryNode[]): DirectoryNode[] => {
    return nodes.sort((a, b) => {
      // If both are directories or both are files, sort them
      if (a.type === b.type) {
        // For files, put dot files before regular files
        if (a.type === 'file') {
          const aIsDotFile = a.name.startsWith('.');
          const bIsDotFile = b.name.startsWith('.');
          if (aIsDotFile !== bIsDotFile) {
            return aIsDotFile ? -1 : 1;
          }
        }
        return a.name.localeCompare(b.name);
      }
      // Put directories before files
      return a.type === 'directory' ? -1 : 1;
    }).map(node => {
      if (node.type === 'directory' && node.children) {
        return { ...node, children: sortNodes(node.children) };
      }
      return node;
    });
  };
  
  return sortNodes(root);
}

function DirectoryStructure({ 
  files, 
  selectedFile, 
  onFileSelect 
}: { 
  files: GeneratedFile[],
  selectedFile: GeneratedFile | null,
  onFileSelect: (file: GeneratedFile) => void
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildDirectoryTree(files), [files]);
  
  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  
  const renderNode = (node: DirectoryNode, level: number = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    
    if (node.type === 'directory') {
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleDir(node.path)}
            className="w-full text-left px-3 py-2 hover:bg-gray-800 rounded flex items-center gap-2 text-gray-300"
            style={{ paddingLeft: `${(level * 12) + 12}px` }}
          >
            {isExpanded ? (
              <ChevronDown size={14} className="flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="flex-shrink-0" />
            )}
            <Folder size={14} className="flex-shrink-0" />
            <span className="truncate text-sm">{node.name}</span>
          </button>
          {isExpanded && node.children?.map(child => renderNode(child, level + 1))}
        </div>
      );
    }
    
    return (
      <button
        key={node.path}
        onClick={() => onFileSelect({ filename: node.path, content: node.content! })}
        className={`w-full text-left px-3 py-2 rounded flex items-center gap-2 text-sm transition-colors ${
          selectedFile?.filename === node.path
            ? 'bg-blue-500/20 text-blue-400'
            : 'text-gray-300 hover:bg-gray-800'
        }`}
        style={{ paddingLeft: `${(level * 12) + 12}px` }}
      >
        <FileText size={14} className="flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  };
  
  return <div className="space-y-1">{tree.map(node => renderNode(node))}</div>;
}

export function Preview({ 
  files, 
  selectedFile, 
  onFileSelect, 
  isLoading
}: PreviewProps) {
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [statusMessages, setStatusMessages] = useState<string[]>([]);
  const [previewLogs, setPreviewLogs] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const statusLogRef = useRef<HTMLDivElement>(null);
  const hasGeneratedCode = files.length > 0;
  const [hasLoadedPreview, setHasLoadedPreview] = useState(false);

  // Update preview when files change or first time switching to preview
  useEffect(() => {
    if (activeTab === 'preview' && files.length > 0 && iframeRef.current) {
      setPreviewLogs(prev => [
        ...prev, 
        "🔄 Starting preview generation...",
        "📂 Scanning files..."
      ]);
      
      const iframe = iframeRef.current;
      const appFile = files.find(f => f.filename.endsWith('App.tsx') || f.filename.endsWith('App.jsx'));
      const cssFiles = files.filter(f => f.filename.endsWith('.css'));
      
      if (!appFile) {
        setPreviewLogs(prev => [
          ...prev,
          "❌ No App component found",
          "🔍 Looking for files ending with App.tsx or App.jsx",
          "⚠️ Please make sure you have an App component file"
        ]);
        iframe.srcdoc = `
          <div style="color: red; padding: 1rem;">
            No App component found. Please make sure you have an App.tsx or App.jsx file.
          </div>
        `;
        return;
      }

      setPreviewLogs(prev => [
        ...prev,
        "✅ Found App component",
        `📦 Found ${cssFiles.length} CSS files`,
        "🔨 Preparing preview environment..."
      ]);

      // Create the preview HTML
      const previewHtml = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
    <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.22.17/babel.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
      body { margin: 0; padding: 1rem; }
      ${cssFiles.map(file => file.content).join('\n')}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel">
      // Initialize React components and hooks
      const { useState, useEffect, useRef } = React;
      
      // Simple routing hooks
      const useLocation = () => {
        const [path, setPath] = useState(window.location.hash.slice(1) || '/');
        
        useEffect(() => {
          const handleHashChange = () => {
            setPath(window.location.hash.slice(1) || '/');
          };
          window.addEventListener('hashchange', handleHashChange);
          return () => window.removeEventListener('hashchange', handleHashChange);
        }, []);
        
        return { pathname: path };
      };
      
      const useNavigate = () => {
        return (to) => {
          window.location.hash = to;
        };
      };
      
      const Link = ({ to, children, ...props }) => (
        <a
          href={'#' + to}
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = to;
          }}
          {...props}
        >
          {children}
        </a>
      );

      // Error boundary component
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null };
        }

        static getDerivedStateFromError(error) {
          return { hasError: true, error };
        }

        componentDidCatch(error, info) {
          console.error('Error caught by boundary:', error, info);
        }

        render() {
          if (this.state.hasError) {
            return (
              <div style={{ color: 'red', padding: '1rem' }}>
                <h3 style={{ marginBottom: '0.5rem' }}>Error in component:</h3>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>
                  {this.state.error?.message}
                </pre>
              </div>
            );
          }
          return this.props.children;
        }
      }

      // App component code
      ${appFile.content
        .replace(/export\s+default\s+/g, '')
        .replace(/export\s+/g, '')
        .replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '')
        .replace(/import\s+{[^}]*}\s+from\s+['"].*?['"];?\n?/g, '')
        .replace(/import\s+/g, '// import ')
        .replace(/require\([^)]+\)/g, '{}')
        .replace(/module\.exports\s*=\s*/g, 'const App = ')
        .replace(/exports\./g, '// exports.')
        .replace(/BrowserRouter/g, 'div')
        .replace(/Routes/g, 'div')
        .replace(/Route/g, 'div')}

      // Wait for DOM to be ready
      window.addEventListener('load', () => {
        try {
          console.log('Initializing React app');
          const container = document.getElementById('root');
          if (!container) throw new Error('Root element not found');

          const root = ReactDOM.createRoot(container);
          root.render(
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          );
          console.log('App rendered successfully');
          window.parent.postMessage({ type: 'preview-ready' }, '*');
        } catch (error) {
          console.error('Error rendering app:', error);
          document.getElementById('root').innerHTML = 
            '<div style="color: red; padding: 1rem;">' +
              '<h3 style="margin-bottom: 0.5rem">Error rendering app:</h3>' +
              '<pre style="white-space: pre-wrap; font-size: 0.9em">' + 
                error.message + '\\n\\n' + (error.stack || '') +
              '</pre>' +
            '</div>';
        }
      });
    </script>
  </body>
</html>`;

      // Update the iframe
      iframe.srcdoc = previewHtml;
      setPreviewLogs(prev => [
        ...prev,
        "🚀 Preview ready!",
        "👀 Watching for changes..."
      ]);
    }
  }, [activeTab, files]); // Removed hasLoadedPreview from dependencies

  // Reset logs when switching to preview
  useEffect(() => {
    if (activeTab === 'preview') {
      setPreviewLogs([]);
    }
  }, [activeTab]);

  // Keep track of previous files to detect changes
  const prevFiles = useRef(files);
  useEffect(() => {
    prevFiles.current = files;
  }, [files]);

  // Reset hasLoadedPreview when files change
  useEffect(() => {
    setHasLoadedPreview(false);
  }, [files]);

  const handleDownload = async () => {
    const zip = new JSZip();
    
    // Add all files to the zip
    files.forEach(file => {
      if (file.filename !== 'status.log') {
        zip.file(file.filename, file.content);
      }
    });
    
    // Generate the zip file
    const content = await zip.generateAsync({ type: "blob" });
    
    // Create download link and trigger download
    const url = window.URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generated-code.zip';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  // Status message handling (unchanged)
  useEffect(() => {
    const statusLog = files.find(f => f.filename === 'status.log');
    if (statusLog) {
      try {
        const content = JSON.parse(statusLog.content);
        if (content.code) {
          setStatusMessages(prev => [...prev, content.code]);
          if (statusLogRef.current) {
            statusLogRef.current.scrollTop = statusLogRef.current.scrollHeight;
          }
        }
      } catch {
        const messages = statusLog.content.split('\n').filter(msg => msg.trim());
        setStatusMessages(messages);
      }
    }
  }, [files]);

  useEffect(() => {
    if (isLoading) {
      setStatusMessages([]);
    }
  }, [isLoading]);

  return (
    <div className="h-full flex flex-col bg-gray-900 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center border-b border-gray-800 bg-gray-950">
        <PreviewTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          previewAvailable={hasGeneratedCode}
        />
        {files.length > 0 && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 mr-2 text-sm font-medium text-gray-400 hover:text-gray-300 transition-colors"
          >
            <Download size={16} />
            Download
          </button>
        )}
      </div>
      
      <div className="flex-1 min-h-0 relative">
        {activeTab === 'code' ? (
          <div className="absolute inset-0 grid grid-cols-[220px,1fr]">
            {/* File List with directory structure */}
            <div className="border-r border-gray-800 overflow-y-auto bg-gray-900">
              <div className="p-2 h-full">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <div className="animate-spin mb-4">
                      <Loader size={24} />
                    </div>
                    <div 
                      ref={statusLogRef}
                      className="w-full px-4 py-2 text-sm text-gray-400 max-h-[300px] overflow-y-auto space-y-1 bg-gray-800/50 rounded"
                    >
                      {statusMessages.map((msg: string, i: number) => (
                        <div key={i} className="font-mono whitespace-pre-wrap break-words">{msg}</div>
                      ))}
                    </div>
                  </div>
                ) : files.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 gap-2">
                    <FileText size={20} />
                    <span className="text-sm">No files generated yet</span>
                  </div>
                ) : (
                  <DirectoryStructure 
                    files={files.filter(file => file.filename !== 'status.log')}
                    selectedFile={selectedFile}
                    onFileSelect={onFileSelect}
                  />
                )}
              </div>
            </div>

            {/* Code Preview */}
            <div className="bg-gray-950 overflow-hidden flex flex-col">
              {isLoading && !selectedFile ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                  <div className="animate-spin">
                    <Loader size={24} />
                  </div>
                </div>
              ) : selectedFile ? (
                <div className="flex flex-col h-full">
                  <div className="flex-none border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm px-4 py-2">
                    <div className="text-sm font-medium text-gray-400">{selectedFile.filename}</div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <div className="p-4">
                      <CodePreview
                        code={selectedFile.content}
                        language={selectedFile.filename.split('.').pop() || 'plaintext'}
                      />
                    </div>
                  </div>
                </div>
              ) : files.length > 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <span className="text-sm">Select a file to view its contents</span>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <span className="text-sm">Generate code to see the preview</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 bg-gray-950">
            {hasGeneratedCode && files.length > 0 ? (
              <div className="w-full h-full">
                <iframe
                  ref={iframeRef}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title="Preview"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                <span className="text-sm">Generate code to see the preview</span>
              </div>
            )}
          </div>
        )}
      </div>
      {activeTab === 'preview' && (
        <div className="fixed bottom-4 left-4 right-4 bg-black/90 border border-gray-700 rounded-lg shadow-2xl">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <div className="text-sm font-mono text-gray-400">Preview Logs</div>
            <div className="flex gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
            </div>
          </div>
          <div className="p-4">
            <div className="font-mono text-sm text-gray-300 max-h-48 overflow-y-auto space-y-1">
              {previewLogs.length === 0 ? (
                <div className="text-gray-500">No logs yet...</div>
              ) : (
                previewLogs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-gray-500 select-none">$</span>
                    <span className="whitespace-pre-wrap">{log}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}