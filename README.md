# cobli-proxy

Servidor proxy para baixar imagens S3 da Fieldcontrol sem bloqueio de CORS.

## Como subir no Render

1. Suba esta pasta no GitHub
2. Acesse render.com → New → Web Service
3. Conecte o repositório
4. Configure:
   - **Build Command:** (deixe vazio)
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Clique em Deploy
6. Copie a URL gerada (ex: https://cobli-proxy.onrender.com)

## Endpoint

`GET /proxy?url=URL_DA_IMAGEM_ENCODADA`

Exemplo:
`https://cobli-proxy.onrender.com/proxy?url=https%3A%2F%2Fs3.amazonaws.com%2F...`
