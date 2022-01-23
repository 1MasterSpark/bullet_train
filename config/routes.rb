Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  use_doorkeeper

  # Grape API
  mount Api::Base, at: "/api"

  # TODO 🍩 figure out how to extract this for the sprinkles gem.
  # e.g. `resources :things, concerns: [:sortable]`
  concern :sortable do
    collection do
      post :reorder
    end
  end

  collection_actions = [:index, :new, :create]

  devise_for :users, controllers: {
    registrations: "registrations",
    sessions: "sessions",
    omniauth_callbacks: "account/oauth/omniauth_callbacks"
  }

  devise_scope :user do
    scope :users, as: :users do
      post "pre_otp", to: "sessions#pre_otp"
    end
  end

  scope module: "public" do
    root to: "home#index"
    get "invitation" => "home#invitation", :as => "invitation"
    if show_developer_documentation?
      get "docs", to: "home#docs"
      get "docs/*page", to: "home#docs"
    end
  end
  authenticate :user, lambda { |u| u.developer? } do
    # sidekiq provides a web-based interface.
    require "sidekiq/web"
    mount Sidekiq::Web => "/developers/sidekiq"
  end

  namespace :webhooks do
    namespace :incoming do
      resources :bullet_train_webhooks
      namespace :oauth do
        # 🚅 super scaffolding will insert new oauth provider webhooks above this line.
      end
    end
  end

  namespace :account do
    shallow do
      # TODO we need to either implement a dashboard or deprecate this.
      root to: "dashboard#index", as: "dashboard"

      resource :two_factor, only: [:create, :destroy]

      # this is the route the cloudinary field hits.
      namespace :cloudinary do
        resources :upload_signatures
      end

      # user-level onboarding tasks.
      namespace :onboarding do
        # routes for standard onboarding steps are configured in the `bullet_train` gem, but you can add more here.
      end

      # user specific resources.
      resources :users do
        namespace :oauth do
          # 🚅 super scaffolding will insert new oauth providers above this line.
        end

        # routes for standard user actions and resources are configured in the `bullet_train` gem, but you can add more here.
      end

      # team-level resources.
      resources :teams do
        # routes for many teams actions and resources are configured in the `bullet_train` gem, but you can add more here.

        # add your resources here.
        unless scaffolding_things_disabled?
          namespace :scaffolding do
            namespace :absolutely_abstract do
              resources :creative_concepts do
                scope module: "creative_concepts" do
                  resources :collaborators, only: collection_actions
                end

                namespace :creative_concepts do
                  resources :collaborators, except: collection_actions
                end
              end
            end
            resources :absolutely_abstract_creative_concepts, path: "absolutely_abstract/creative_concepts" do
              namespace :completely_concrete do
                resources :tangible_things
              end
            end
          end
        end

        resources :invitations do
          # routes for standard invitation actions and resources are configured in the `bullet_train` gem, but you can add more here.
        end

        resources :memberships do
          # routes for standard membership actions and resources are configured in the `bullet_train` gem, but you can add more here.
        end

        namespace :integrations do
          # 🚅 super scaffolding will insert new integration installations above this line.
        end

        namespace :platform do
          resources :applications
        end
      end
    end
  end

  if demo?
    get "/call", to: redirect("https://calendly.com/bullettrain/introductions"), as: "call"
  end
end
