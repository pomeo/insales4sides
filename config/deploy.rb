set :application, "4sides.salesapps.ru"
#========================
#CONFIG
#========================
require           "capistrano-offroad"
offroad_modules   "defaults", "supervisord"
set :repository,  "git@github.com:pomeo/insales4sides.git"
set :supervisord_start_group, "app"
set :supervisord_stop_group, "app"
#========================
#ROLES
#========================
set  :gateway,    "#{application}" # main server
role :app,        "10.3.10.80"      # container

namespace :deploy do
  desc "Folder permission"
  task :perm do
    run "chmod 777 #{current_path}/public"
  end
end

after "deploy:create_symlink",
      "deploy:npm_install",
      "deploy:perm",
      "deploy:cleanup",
      "deploy:restart"
