import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import * as cheerio from 'cheerio';
import webhooksRouter from './routes/webhooks';

export function createServer() {
    const app = express();

    // Serve our custom paywall injection scripts directly
    app.use('/paywall.js', express.static(path.join(__dirname, 'public', 'paywall.js')));
    app.use('/paywall.css', express.static(path.join(__dirname, 'public', 'paywall.css')));

    // We must parse JSON for our own API routes BEFORE the proxy catches everything
    app.use('/v1/webhooks', cors(), bodyParser.json(), webhooksRouter);

    // Healthcheck
    app.get('/health', (req, res) => {
        res.json({ status: 'healthy', version: '1.0.0' });
    });

    // The Magic Reverse Proxy (Catch-all)
    // This proxies everything else to the Mock Owncast running on port 8080
    app.use('/', createProxyMiddleware({
        target: 'http://localhost:8080',
        changeOrigin: true,
        selfHandleResponse: true, // We will handle the response to inject HTML
        on: {
            proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
                // If it's an HTML page (like the main stream page), we inject our paywall!
                if (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html')) {
                    const html = responseBuffer.toString('utf8');
                    const $ = cheerio.load(html);
                    
                    // Inject our Arc Paywall script at the end of the body
                    $('body').append('<script src="/paywall.js"></script>');
                    
                    return $.html();
                }
                
                // For images, videos, and other assets, just pass them through unmodified
                return responseBuffer;
            }),
            error: (err, req, res) => {
                console.error('[Proxy Error]', err);
                (res as express.Response).status(502).send('Error proxying to Owncast. Is it running on port 8080?');
            }
        }
    }));

    return app;
}
