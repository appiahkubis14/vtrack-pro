# ---------- base ----------
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---------- development ----------
FROM base AS development
RUN npm install
COPY . .
CMD ["npm", "run", "start:dev"]

# ---------- build ----------
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build
RUN npm ci --omit=dev

# ---------- production ----------
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
EXPOSE 3000 5023 5040 5050
COPY --from=build /app/scripts ./scripts
CMD ["node", "dist/src/main.js"]
