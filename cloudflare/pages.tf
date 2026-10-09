# Main marketing site → Cloudflare Pages
resource "cloudflare_pages_project" "main_frontend" {
  account_id        = var.cloudflare_account_id
  name              = "prket-alandlos-site"
  production_branch = "main"

  source = {
    type = "github"
    config = {
      owner             = var.github_owner
      repo_name         = var.main_frontend_repo
      production_branch = "main"
    }
  }

  build_config = {
    build_command   = "npm run build"
    destination_dir = "dist"
  }

  deployment_configs = {
    production = {
      env_vars = {
        NODE_VERSION = {
          type  = "plain_text"
          value = "20"
        }
        VITE_SERVER_URL = {
          type  = "plain_text"
          value = "https://api.${var.zone_name}"
        }
      }
    }
    preview = {
      env_vars = {
        NODE_VERSION = {
          type  = "plain_text"
          value = "20"
        }
        VITE_SERVER_URL = {
          type  = "plain_text"
          value = "https://api.${var.zone_name}"
        }
      }
    }
  }
}

# Admin panel → Cloudflare Pages (two API env vars: products API + auth API)
resource "cloudflare_pages_project" "admin_frontend" {
  account_id        = var.cloudflare_account_id
  name              = "prket-alandlos-admin"
  production_branch = "main"

  source = {
    type = "github"
    config = {
      owner             = var.github_owner
      repo_name         = var.admin_frontend_repo
      production_branch = "main"
    }
  }

  build_config = {
    build_command   = "npm run build"
    destination_dir = "dist"
  }

  deployment_configs = {
    production = {
      env_vars = {
        NODE_VERSION = {
          type  = "plain_text"
          value = "20"
        }
        VITE_SERVER_URL = {
          type  = "plain_text"
          value = "https://api.${var.zone_name}"
        }
        VITE_ADMIN_BACKEND_URL = {
          type  = "plain_text"
          value = "https://auth.${var.zone_name}"
        }
      }
    }
    preview = {
      env_vars = {
        NODE_VERSION = {
          type  = "plain_text"
          value = "20"
        }
        VITE_SERVER_URL = {
          type  = "plain_text"
          value = "https://api.${var.zone_name}"
        }
        VITE_ADMIN_BACKEND_URL = {
          type  = "plain_text"
          value = "https://auth.${var.zone_name}"
        }
      }
    }
  }
}

# Custom domains for both Pages projects (CNAME records are created automatically)
resource "cloudflare_pages_domain" "site" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.main_frontend.name
  name         = local.site_domain
}

resource "cloudflare_pages_domain" "admin" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.admin_frontend.name
  name         = local.admin_domain
}
