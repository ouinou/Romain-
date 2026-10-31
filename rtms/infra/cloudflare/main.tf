# Cloudflare devant RTMS : WAF, limitation de débit, anti-DDoS, TLS strict.
# Usage : export CLOUDFLARE_API_TOKEN=... ; terraform init ; terraform plan -var zone_id=... -var hostname=rtms.example.td
# NON VÉRIFIÉ dans ce dépôt (nécessite un compte Cloudflare) : à valider avec `terraform plan`.
terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.48" }
  }
}

variable "zone_id" { type = string }
variable "hostname" { type = string }
variable "allowed_countries" {
  type        = list(string)
  default     = ["TD", "CM", "FR"]  # à adapter : pays d'où les utilisateurs se connectent
  description = "Pays autorisés à joindre l'application (les autres reçoivent un défi)"
}

# TLS : chiffrement complet strict entre Cloudflare et l'origine, TLS 1.2 minimum
resource "cloudflare_zone_settings_override" "rtms" {
  zone_id = var.zone_id
  settings {
    ssl                      = "strict"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    security_level           = "medium"
    browser_check            = "on"
    http3                    = "on"
  }
}

# Seul Cloudflare peut joindre l'origine (mTLS côté Caddy)
resource "cloudflare_authenticated_origin_pulls" "rtms" {
  zone_id = var.zone_id
  enabled = true
}

# Règles WAF gérées : Cloudflare Managed Ruleset + OWASP Core Ruleset
resource "cloudflare_ruleset" "managed_waf" {
  zone_id = var.zone_id
  name    = "RTMS — WAF géré"
  kind    = "zone"
  phase   = "http_request_firewall_managed"
  rules {
    action      = "execute"
    expression  = "true"
    description = "Cloudflare Managed Ruleset"
    action_parameters { id = "efb7b8c949ac4650a09736fc376e9aee" }
  }
  rules {
    action      = "execute"
    expression  = "true"
    description = "OWASP Core Ruleset (seuil paranoïa 2)"
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f"
      overrides {
        categories {
          category = "paranoia-level-3"
          enabled  = false
        }
        categories {
          category = "paranoia-level-4"
          enabled  = false
        }
      }
    }
  }
}

# Règles personnalisées
resource "cloudflare_ruleset" "custom_waf" {
  zone_id = var.zone_id
  name    = "RTMS — règles personnalisées"
  kind    = "zone"
  phase   = "http_request_firewall_custom"
  rules {
    action      = "block"
    expression  = "(http.host eq \"${var.hostname}\" and starts_with(http.request.uri.path, \"/metrics\"))"
    description = "Métriques jamais exposées"
  }
  rules {
    action      = "block"
    expression  = "(http.host eq \"${var.hostname}\" and not http.request.method in {\"GET\" \"POST\" \"PUT\" \"PATCH\" \"HEAD\"})"
    description = "Méthodes HTTP non utilisées"
  }
  rules {
    action      = "managed_challenge"
    expression  = "(http.host eq \"${var.hostname}\" and not ip.geoip.country in {${join(" ", [for c in var.allowed_countries : "\"${c}\""])}})"
    description = "Défi hors des pays autorisés"
  }
}

# Limitation de débit en bordure (complète celle de l'API)
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.zone_id
  name    = "RTMS — limitation de débit"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules {
    action      = "block"
    expression  = "(http.host eq \"${var.hostname}\" and http.request.uri.path eq \"/api/auth/login\")"
    description = "Connexion : 20 requêtes / minute / IP"
    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 600
    }
  }
  rules {
    action      = "managed_challenge"
    expression  = "(http.host eq \"${var.hostname}\" and starts_with(http.request.uri.path, \"/api/\"))"
    description = "API : 1500 requêtes / minute / IP (bureau derrière NAT inclus)"
    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = 1500
      mitigation_timeout  = 120
    }
  }
}
