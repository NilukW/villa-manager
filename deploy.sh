#!/bin/bash
# VillaManager GCP VM Deployment Script (Ubuntu)

echo "Starting Deployment Setup for VillaManager..."

# 1. Update system & install Node.js and dependencies
sudo apt update
sudo apt install -y curl nginx sqlite3 git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Install PM2 globally to keep the Node backend running forever
sudo npm install -g pm2

# 3. Setup Backend
echo "Setting up Backend..."
cd backend
npm install
pm2 start server.js --name "villamanager-api"
pm2 save
pm2 startup | tail -n 1 | sudo bash
cd ..

# 4. Setup Frontend
echo "Setting up Frontend..."
cd frontend
npm install
npm run build

# 5. Configure Nginx
echo "Configuring Nginx Reverse Proxy..."
sudo rm -f /etc/nginx/sites-enabled/default

cat << 'EOF' | sudo tee /etc/nginx/sites-available/villamanager
server {
    listen 80;
    server_name _; 

    root /home/YOUR_USERNAME/villa-manager/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Grant Nginx permissions to traverse the user's home directory
chmod 755 /home/$(whoami)

# Update the Nginx config with the actual Linux username
sudo sed -i "s|YOUR_USERNAME|$(whoami)|g" /etc/nginx/sites-available/villamanager

sudo ln -s /etc/nginx/sites-available/villamanager /etc/nginx/sites-enabled/
sudo systemctl restart nginx

echo "====================================================="
echo "Deployment Complete! Your application is now running."
echo "You can access it using your VM's External IP Address."
echo "Default built-in Login is admin / admin123"
echo "====================================================="
