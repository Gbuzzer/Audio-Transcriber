# Railway Deployment Guide

## 🚀 Quick Deploy to Railway

### Prerequisites
- GitHub repository with the Audio Transcriber code
- OpenAI API key
- Railway account (free tier available)

### Step-by-Step Deployment

#### 1. **Create Railway Account**
- Visit [railway.app](https://railway.app)
- Sign up with GitHub account
- Connect your GitHub repository

#### 2. **Deploy from GitHub**
```bash
# Railway will automatically detect:
# - Node.js project
# - package.json dependencies
# - Start command from package.json
```

#### 3. **Configure Environment Variables**
In Railway dashboard, add these environment variables:

```env
OPENAI_API_KEY=your_actual_openai_api_key_here
PIN_CODE=0411
NODE_ENV=production
```

#### 4. **Domain Configuration**
- Railway provides a free `.railway.app` subdomain
- Custom domain can be configured in Railway dashboard
- Automatic HTTPS is included

### 🔧 Technical Configuration

#### Files Created for Deployment:
- `railway.toml` - Railway-specific configuration
- `Procfile` - Process definition
- `.env.example` - Environment variable template

#### Build Process:
1. Railway detects Node.js project
2. Runs `npm install` automatically
3. Starts with `npm start` command
4. Serves on Railway-provided port

#### Environment Variables Required:
- `OPENAI_API_KEY` - Your OpenAI API key for Whisper
- `PIN_CODE` - 4-digit PIN for app access (default: 0411)
- `PORT` - Automatically set by Railway

### 🌐 Post-Deployment

#### Access Your App:
- Railway provides URL: `https://your-app-name.railway.app`
- PIN authentication will be active
- All features available including file uploads

#### Monitoring:
- Railway dashboard shows logs and metrics
- Automatic deployments on GitHub pushes
- Built-in SSL/HTTPS

### 💡 Tips

1. **Custom Domain**: Configure in Railway dashboard for professional URL
2. **Environment Variables**: Keep OpenAI API key secure
3. **Monitoring**: Check Railway logs for any issues
4. **Updates**: Push to GitHub main branch for automatic deployment

### 🔒 Security Notes

- PIN authentication protects the application
- Environment variables are encrypted in Railway
- HTTPS is automatically enabled
- Session-based authentication for secure access
