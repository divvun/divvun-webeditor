export interface LayoutProps {
  title: string;
  description?: string;
  children: unknown;
}

export default function Layout({ title, description, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="stylesheet" href="/style.css" />
        <link
          href="https://cdn.quilljs.com/1.3.7/quill.snow.css"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 p-4 md:p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden backdrop-blur-sm bg-white/95">
          <div className="bg-gradient-to-r from-green-500 to-blue-600 text-white p-6 text-center">
            <h1 className="text-3xl font-bold mb-2">{title}</h1>
            {description && (
              <p className="text-green-100 opacity-90">{description}</p>
            )}
          </div>
          {children}
        </div>
        <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
        <script src="quill-bridge.js"></script>
        <script type="module" src="main.js"></script>
      </body>
    </html>
  );
}
