FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Virtual display + browser viewer (noVNC) for LinkedIn sign-in
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify python3-websockify fluxbox procps \
    x11-apps x11-utils \
    && rm -rf /var/lib/apt/lists/* \
    && printf 'precedence :ffff:0:0/96  100\n' > /etc/gai.conf

COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev --ignore-scripts

COPY . .

RUN mkdir -p .auth output data/rag-cache knowledge

ENV PORT=6363
ENV HEADLESS=false
ENV DISPLAY=:99
ENV IN_DOCKER=true
ENV MONGODB_URI=mongodb://mongo:27017
ENV MONGODB_DB=linkedin_scrapper

EXPOSE 6363 6080

COPY docker/entrypoint.sh /entrypoint.sh
# Strip Windows CRLF so Linux can exec this file
RUN sed -i '1s/^\xEF\xBB\xBF//;s/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Use sh (not exec of the file) so CRLF shebang cannot cause "exec format error"
ENTRYPOINT ["sh", "/entrypoint.sh"]
CMD ["node", "src/server.js"]
