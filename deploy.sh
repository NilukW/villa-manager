#!/bin/bash
# VillaManager GCP VM Deployment Script (Ubuntu)

echo "Starting Deployment Setup for VillaManager..."

# 1. Update system & install Node.js and dependencies
sudo apt update
sudo apt install -y curl nginx sqlite3 git apache2-utils
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

# 5. Access Control (Password Protection)
echo "Setting up secure access..."
# IMPORTANT: You can change 'admin' and 'Villa2026' to your preferred Username and Password
sudo htpasswd -cb /etc/nginx/.htpasswd admin Villa2026

# 6. Configure Nginx
echo "Configuring Nginx Reverse Proxy..."
sudo rm -f /etc/nginx/sites-enabled/default

cat << 'EOF' | sudo tee /etc/nginx/sites-available/villamanager
server {
    listen 80;
    server_name _; 

    # Require Password to access the site
    auth_basic "Restricted VillaManager Dashboard";
    auth_basic_user_file /etc/nginx/.htpasswd;

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

# Update the Nginx config with the actual Linux username
sed -i "s|YOUR_USERNAME|$(whoami)|g" /etc/nginx/sites-available/villamanager

sudo ln -s /etc/nginx/sites-available/villamanager /etc/nginx/sites-enabled/
sudo systemctl restart nginx

echo "====================================================="
echo "Deployment Complete! Your secure site is now running."
echo "Username: admin"
echo "Password: Villa2026"
echo "You can access it using your VM's External IP Address"
echo "====================================================="
