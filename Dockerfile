# Dockerfile for the Audio Transcriber application

# 1. Use an official Node.js runtime as a parent image
FROM node:18-slim

# 2. Install ffmpeg
# We need this for audio processing.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# 3. Set the working directory in the container
WORKDIR /usr/src/app

# 4. Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# 5. Install app dependencies
RUN npm install

# 6. Copy the rest of your application's code from your host to your image filesystem.
COPY . .

# 7. Your app binds to port 3000, so you need to expose it
EXPOSE 3000

# 8. Define the command to run your app
CMD [ "node", "server.js" ]
