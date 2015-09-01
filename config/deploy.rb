set :application, "m.insales.sovechkin.com"
#========================
#CONFIG
#========================
require           "capistrano-offroad"
offroad_modules   "defaults", "supervisord"
set :repository,  "git@github.com:pomeo/insales4sides.git"
set :deploy_to,   "/home/ubuntu/projects/4sides"
set :supervisord_start_group, "4sides"
set :supervisord_stop_group, "4sides"
#========================
#ROLES
#========================
role :app,        "ubuntu@#{application}"

namespace :deploy do
  desc "Change node.js port"
  task :chg_port do
    run "sed -i 's/3000/3600/g' #{current_path}/app.js"
  end
end

after "deploy:create_symlink", "deploy:npm_install", "deploy:chg_port", "deploy:restart"
