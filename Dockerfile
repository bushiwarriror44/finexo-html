FROM node:20-alpine

WORKDIR /app

# Устанавливаем зависимости отдельно, чтобы кешировался слой
COPY package*.json ./
RUN npm install

# Копируем остальной код
COPY . .

# Vite по умолчанию использует порт 5173
EXPOSE 5173

# Запускаем dev-сервер Vite, доступный извне контейнера
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM python:3.9-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/dist ./dist/

WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=app.py

CMD ["gunicorn", "-w", "1", "--threads", "100", "-b", "0.0.0.0:3914", "wsgi:app"]
