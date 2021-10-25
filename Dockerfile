FROM node:current-alpine
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install --production
COPY . .
CMD [ "node", "index.js" ]

