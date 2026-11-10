export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_installations: {
        Row: {
          created_at: string
          id: string
          installation_id: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          installation_id: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          installation_id?: string
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_installations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_restrictions: {
        Row: {
          actors: number
          created_at: string
          id: string
          restricted_until: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actors: number
          created_at?: string
          id?: string
          restricted_until: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actors?: number
          created_at?: string
          id?: string
          restricted_until?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_restrictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          message_id: string
          message_kind: string
          mime_type: string | null
          pop_id: string | null
          position: number
          poster_url: string | null
          size_bytes: number | null
          url: string | null
          waveform: number[] | null
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          message_id: string
          message_kind: string
          mime_type?: string | null
          pop_id?: string | null
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url?: string | null
          waveform?: number[] | null
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          message_id?: string
          message_kind?: string
          mime_type?: string | null
          pop_id?: string | null
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url?: string | null
          waveform?: number[] | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_message_kind_fkey"
            columns: ["message_id", "message_kind"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "attachments_message_id_message_kind_fkey"
            columns: ["message_id", "message_kind"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "attachments_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          last_pop_at: string | null
          owner_id: string | null
          posts_chat_id: string
          posts_chat_kind: string
          readers_count: number
          subscribers_count: number
          title: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          last_pop_at?: string | null
          owner_id?: string | null
          posts_chat_id: string
          posts_chat_kind?: string
          readers_count?: number
          subscribers_count?: number
          title: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          last_pop_at?: string | null
          owner_id?: string | null
          posts_chat_id?: string
          posts_chat_kind?: string
          readers_count?: number
          subscribers_count?: number
          title?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_posts_chat_id_posts_chat_kind_fkey"
            columns: ["posts_chat_id", "posts_chat_kind"]
            isOneToOne: true
            referencedRelation: "chat_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "channels_posts_chat_id_posts_chat_kind_fkey"
            columns: ["posts_chat_id", "posts_chat_kind"]
            isOneToOne: true
            referencedRelation: "chats"
            referencedColumns: ["id", "kind"]
          },
        ]
      }
      chat_invites: {
        Row: {
          accepted_at: string | null
          chat_id: string
          created_at: string
          declined_at: string | null
          id: string
          invitee_id: string | null
          inviter_id: string | null
          status: string
          inviter_avatar_url: string | null
          inviter_name: string | null
        }
        Insert: {
          accepted_at?: string | null
          chat_id: string
          created_at?: string
          declined_at?: string | null
          id?: string
          invitee_id?: string | null
          inviter_id?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          chat_id?: string
          created_at?: string
          declined_at?: string | null
          id?: string
          invitee_id?: string | null
          inviter_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_invites_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          chat_id: string
          id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          founding_member_ids: string[]
          id: string
          kind: string
          last_message_author_id: string | null
          last_message_text: string | null
          owner_id: string | null
          public_hold_seq: number | null
          request_pending: boolean
          subscribers_count: number
          time_restricted: boolean
          title: string | null
          username: string | null
          chat_am_member: boolean | null
          chat_display_name: string | null
          chat_read_up_to: string | null
          last_message_at: string | null
          last_message_preview: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          founding_member_ids?: string[]
          id?: string
          kind: string
          last_message_author_id?: string | null
          last_message_text?: string | null
          owner_id?: string | null
          public_hold_seq?: number | null
          request_pending?: boolean
          subscribers_count?: number
          time_restricted?: boolean
          title?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          founding_member_ids?: string[]
          id?: string
          kind?: string
          last_message_author_id?: string | null
          last_message_text?: string | null
          owner_id?: string | null
          public_hold_seq?: number | null
          request_pending?: boolean
          subscribers_count?: number
          time_restricted?: boolean
          title?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_last_message_author_id_fkey"
            columns: ["last_message_author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_attachments: {
        Row: {
          comment_id: string
          comment_kind: string
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          mime_type: string | null
          position: number
          poster_url: string | null
          size_bytes: number | null
          url: string
          waveform: number[] | null
          width: number | null
        }
        Insert: {
          comment_id: string
          comment_kind: string
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url: string
          waveform?: number[] | null
          width?: number | null
        }
        Update: {
          comment_id?: string
          comment_kind?: string
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url?: string
          waveform?: number[] | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comment_attachments_comment_fkey"
            columns: ["comment_id", "comment_kind"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "comment_attachments_comment_fkey"
            columns: ["comment_id", "comment_kind"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "kind"]
          },
        ]
      }
      comment_pins: {
        Row: {
          comment_id: string
          created_at: string
          deleted_at: string | null
          id: string
          pinned_by: string | null
          target_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          pinned_by?: string | null
          target_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          pinned_by?: string | null
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_pins_comment_id_target_id_fkey"
            columns: ["comment_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comment_pins_comment_id_target_id_fkey"
            columns: ["comment_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comment_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_replies: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          position: number
          quoted_id: string
          target_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          position: number
          quoted_id: string
          target_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          position?: number
          quoted_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_replies_comment_fkey"
            columns: ["comment_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comment_replies_comment_fkey"
            columns: ["comment_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comment_replies_quoted_fkey"
            columns: ["quoted_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comment_replies_quoted_fkey"
            columns: ["quoted_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "target_id"]
          },
        ]
      }
      comment_revisions: {
        Row: {
          attachments: Json
          author_id: string | null
          chat_id: string
          comment_id: string
          created_at: string
          id: string
          kind: string
          message_id: string | null
          pop_id: string | null
          text: string | null
          version_at: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          chat_id: string
          comment_id: string
          created_at?: string
          id?: string
          kind: string
          message_id?: string | null
          pop_id?: string | null
          text?: string | null
          version_at: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          chat_id?: string
          comment_id?: string
          created_at?: string
          id?: string
          kind?: string
          message_id?: string | null
          pop_id?: string | null
          text?: string | null
          version_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_revisions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          audience: string
          author_id: string | null
          chat_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          fragment_id: string | null
          id: string
          kind: string
          member_reactions: Json
          message_id: string | null
          pop_id: string | null
          rank: number | null
          reactions_count: number
          replies_count: number
          target_id: string | null
          text: string | null
          thread_root_id: string | null
          visitor_reactions: Json
        }
        Insert: {
          audience?: string
          author_id?: string | null
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          fragment_id?: string | null
          id?: string
          kind: string
          member_reactions?: Json
          message_id?: string | null
          pop_id?: string | null
          rank?: number | null
          reactions_count?: number
          replies_count?: number
          target_id?: string | null
          text?: string | null
          thread_root_id?: string | null
          visitor_reactions?: Json
        }
        Update: {
          audience?: string
          author_id?: string | null
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          fragment_id?: string | null
          id?: string
          kind?: string
          member_reactions?: Json
          message_id?: string | null
          pop_id?: string | null
          rank?: number | null
          reactions_count?: number
          replies_count?: number
          target_id?: string | null
          text?: string | null
          thread_root_id?: string | null
          visitor_reactions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_fragment_fkey"
            columns: ["fragment_id", "message_id"]
            isOneToOne: false
            referencedRelation: "fragment_rows"
            referencedColumns: ["id", "message_id"]
          },
          {
            foreignKeyName: "comments_fragment_fkey"
            columns: ["fragment_id", "message_id"]
            isOneToOne: false
            referencedRelation: "message_fragments"
            referencedColumns: ["id", "message_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "comments_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_thread_root_fkey"
            columns: ["thread_root_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comments_thread_root_fkey"
            columns: ["thread_root_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "target_id"]
          },
        ]
      }
      contact_request_log: {
        Row: {
          created_at: string
          id: string
          kind: string
          requester_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          requester_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          requester_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_request_log_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          installation_id: string
          last_seen_at: string
          model: string | null
          os_version: string | null
          platform: string
          push_token: string | null
          push_token_updated_at: string | null
          session_id: string | null
          signed_out_at: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          installation_id: string
          last_seen_at?: string
          model?: string | null
          os_version?: string | null
          platform: string
          push_token?: string | null
          push_token_updated_at?: string | null
          session_id?: string | null
          signed_out_at?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          installation_id?: string
          last_seen_at?: string
          model?: string | null
          os_version?: string | null
          platform?: string
          push_token?: string | null
          push_token_updated_at?: string | null
          session_id?: string | null
          signed_out_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dialogue_requests: {
        Row: {
          addressee_id: string
          chat_id: string
          closed_at: string | null
          created_at: string
          id: string
          outcome: string | null
          requester_id: string
        }
        Insert: {
          addressee_id: string
          chat_id: string
          closed_at?: string | null
          created_at?: string
          id?: string
          outcome?: string | null
          requester_id: string
        }
        Update: {
          addressee_id?: string
          chat_id?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          outcome?: string | null
          requester_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialogue_requests_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_requests_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_requests_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forward_items: {
        Row: {
          chat_id: string
          created_at: string
          deleted_at: string | null
          forward_id: string
          forward_kind: string
          id: string
          message_id: string
          position: number
        }
        Insert: {
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          forward_id: string
          forward_kind?: string
          id?: string
          message_id: string
          position: number
        }
        Update: {
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          forward_id?: string
          forward_kind?: string
          id?: string
          message_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "forward_items_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forward_items_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forward_items_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "forward_items_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "forward_items_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "forward_items_forward_kind_fkey"
            columns: ["forward_id", "forward_kind"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "forward_items_forward_kind_fkey"
            columns: ["forward_id", "forward_kind"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "forward_items_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "forward_items_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forward_items_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_cluster_config: {
        Row: {
          created_at: string
          id: string
          note: string | null
          params: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          params: Json
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          params?: Json
          version?: number
        }
        Relationships: []
      }
      fragment_cluster_decisions: {
        Row: {
          created_at: string
          decision: Json
          displayed: Json
          id: string
          interactions: number
          message_id: string
          model_version: number
          scorer: string | null
        }
        Insert: {
          created_at?: string
          decision: Json
          displayed?: Json
          id?: string
          interactions?: number
          message_id: string
          model_version: number
          scorer?: string | null
        }
        Update: {
          created_at?: string
          decision?: Json
          displayed?: Json
          id?: string
          interactions?: number
          message_id?: string
          model_version?: number
          scorer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragment_cluster_decisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fragment_cluster_decisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_decisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_cluster_events: {
        Row: {
          cluster_id: string | null
          created_at: string
          decision_id: string | null
          detail: Json
          fragment_id: string | null
          id: string
          kind: string
          message_id: string
          placement: string | null
          range_end: number | null
          range_start: number | null
          user_id: string | null
        }
        Insert: {
          cluster_id?: string | null
          created_at?: string
          decision_id?: string | null
          detail?: Json
          fragment_id?: string | null
          id?: string
          kind: string
          message_id: string
          placement?: string | null
          range_end?: number | null
          range_start?: number | null
          user_id?: string | null
        }
        Update: {
          cluster_id?: string | null
          created_at?: string
          decision_id?: string | null
          detail?: Json
          fragment_id?: string | null
          id?: string
          kind?: string
          message_id?: string
          placement?: string | null
          range_end?: number | null
          range_start?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragment_cluster_events_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "fragment_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "fragment_cluster_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "fragment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_fragment_id_fkey"
            columns: ["fragment_id"]
            isOneToOne: false
            referencedRelation: "message_fragments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_cluster_state: {
        Row: {
          created_at: string
          decision_id: string | null
          decisions_skipped: number
          id: string
          interactions: number
          lease_token: string | null
          lease_until: string | null
          message_id: string
          model_version: number | null
          queued_at: string | null
          recomputed_at: string | null
          recomputed_interactions: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          decisions_skipped?: number
          id?: string
          interactions?: number
          lease_token?: string | null
          lease_until?: string | null
          message_id: string
          model_version?: number | null
          queued_at?: string | null
          recomputed_at?: string | null
          recomputed_interactions?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          decisions_skipped?: number
          id?: string
          interactions?: number
          lease_token?: string | null
          lease_until?: string | null
          message_id?: string
          model_version?: number | null
          queued_at?: string | null
          recomputed_at?: string | null
          recomputed_interactions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fragment_cluster_state_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "fragment_cluster_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_state_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fragment_cluster_state_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_state_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_cluster_voters: {
        Row: {
          cluster_id: string
          created_at: string
          id: string
          user_id: string | null
          votes: number
        }
        Insert: {
          cluster_id: string
          created_at?: string
          id?: string
          user_id?: string | null
          votes?: number
        }
        Update: {
          cluster_id?: string
          created_at?: string
          id?: string
          user_id?: string | null
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "fragment_cluster_voters_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "fragment_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_cluster_voters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fragment_cluster_worker: {
        Row: {
          created_at: string
          id: string
          kicked_at: string
          request_id: number
          singleton: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          kicked_at: string
          request_id: number
          singleton?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          kicked_at?: string
          request_id?: number
          singleton?: boolean
        }
        Relationships: []
      }
      fragment_clusters: {
        Row: {
          chat_id: string
          comments_count: number
          created_at: string
          decision_id: string | null
          deleted_at: string | null
          display_end: number | null
          display_start: number | null
          dominant_emoji: string | null
          end_offset: number
          id: string
          member_reactions: Json
          message_id: string
          model_version: number
          people_count: number
          popularity: number
          reactions_count: number
          start_offset: number
          updated_at: string
          visitor_reactions: Json
        }
        Insert: {
          chat_id: string
          comments_count?: number
          created_at?: string
          decision_id?: string | null
          deleted_at?: string | null
          display_end?: number | null
          display_start?: number | null
          dominant_emoji?: string | null
          end_offset: number
          id?: string
          member_reactions?: Json
          message_id: string
          model_version: number
          people_count?: number
          popularity?: number
          reactions_count?: number
          start_offset: number
          updated_at?: string
          visitor_reactions?: Json
        }
        Update: {
          chat_id?: string
          comments_count?: number
          created_at?: string
          decision_id?: string | null
          deleted_at?: string | null
          display_end?: number | null
          display_start?: number | null
          dominant_emoji?: string | null
          end_offset?: number
          id?: string
          member_reactions?: Json
          message_id?: string
          model_version?: number
          people_count?: number
          popularity?: number
          reactions_count?: number
          start_offset?: number
          updated_at?: string
          visitor_reactions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fragment_clusters_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "fragment_cluster_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragment_clusters_dominant_emoji_fkey"
            columns: ["dominant_emoji"]
            isOneToOne: false
            referencedRelation: "reaction_emojis"
            referencedColumns: ["emoji"]
          },
          {
            foreignKeyName: "fragment_clusters_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "fragment_clusters_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "fragment_clusters_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
        ]
      }
      friend_request_log: {
        Row: {
          created_at: string
          id: string
          requester_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          requester_id: string
        }
        Update: {
          created_at?: string
          id?: string
          requester_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_request_log_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: string
          withdrawn_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          responded_at?: string | null
          status?: string
          withdrawn_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_secret: {
        Row: {
          created_at: string
          id: string
          secret: string
        }
        Insert: {
          created_at?: string
          id?: string
          secret?: string
        }
        Update: {
          created_at?: string
          id?: string
          secret?: string
        }
        Relationships: []
      }
      legacy_comment_quotes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          position: number
          quoted_at: string
          quoted_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          position: number
          quoted_at: string
          quoted_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          position?: number
          quoted_at?: string
          quoted_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legacy_comment_quotes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_comment_quotes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_comment_quotes_quoted_id_fkey"
            columns: ["quoted_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_comment_quotes_quoted_id_fkey"
            columns: ["quoted_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_forward_copies: {
        Row: {
          copy_id: string
          created_at: string
          forward_item_id: string | null
          id: string
          note: string | null
        }
        Insert: {
          copy_id: string
          created_at?: string
          forward_item_id?: string | null
          id?: string
          note?: string | null
        }
        Update: {
          copy_id?: string
          created_at?: string
          forward_item_id?: string | null
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legacy_forward_copies_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "legacy_forward_copies_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_forward_copies_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_forward_copies_forward_item_id_fkey"
            columns: ["forward_item_id"]
            isOneToOne: false
            referencedRelation: "forward_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_forward_copies_forward_item_id_fkey"
            columns: ["forward_item_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["forward_item_id"]
          },
        ]
      }
      media_objects: {
        Row: {
          bucket: string
          created_at: string
          id: string
          kind: string
          mime_type: string
          owner_id: string
          path: string
          sanitized_at: string
          size_bytes: number
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          kind: string
          mime_type: string
          owner_id: string
          path: string
          sanitized_at?: string
          size_bytes: number
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string
          owner_id?: string
          path?: string
          sanitized_at?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_objects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_fragments: {
        Row: {
          anchor_state: string
          author_id: string | null
          chat_id: string
          cluster_id: string | null
          comments_count: number
          created_at: string
          deleted_at: string | null
          end_offset: number
          exact_text: string
          id: string
          member_reactions: Json
          message_id: string
          prefix_text: string
          reactions_count: number
          start_offset: number
          suffix_text: string
          text_version: string
          updated_at: string
          visitor_reactions: Json
          my_reaction: {
            audience: string
            chat_id: string | null
            created_at: string
            deleted_at: string | null
            emoji: string
            id: string
            target_id: string
            target_type: string
            updated_at: string
            user_id: string | null
          } | null
        }
        Insert: {
          anchor_state?: string
          author_id?: string | null
          chat_id: string
          cluster_id?: string | null
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          end_offset: number
          exact_text: string
          id?: string
          member_reactions?: Json
          message_id: string
          prefix_text?: string
          reactions_count?: number
          start_offset: number
          suffix_text?: string
          text_version: string
          updated_at?: string
          visitor_reactions?: Json
        }
        Update: {
          anchor_state?: string
          author_id?: string | null
          chat_id?: string
          cluster_id?: string | null
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          end_offset?: number
          exact_text?: string
          id?: string
          member_reactions?: Json
          message_id?: string
          prefix_text?: string
          reactions_count?: number
          start_offset?: number
          suffix_text?: string
          text_version?: string
          updated_at?: string
          visitor_reactions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_fragments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_fragments_cluster_fkey"
            columns: ["cluster_id", "message_id"]
            isOneToOne: false
            referencedRelation: "fragment_clusters"
            referencedColumns: ["id", "message_id"]
          },
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
        ]
      }
      message_pins: {
        Row: {
          chat_id: string
          created_at: string
          deleted_at: string | null
          forward_id: string | null
          id: string
          message_id: string
          pinned_by: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          forward_id?: string | null
          id?: string
          message_id: string
          pinned_by?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          forward_id?: string | null
          id?: string
          message_id?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_pins_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "message_pins_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_pins_forward_fkey"
            columns: ["forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_pins_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_pins_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_replies: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          message_id: string
          position: number
          quoted_forward_id: string | null
          quoted_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          message_id: string
          position: number
          quoted_forward_id?: string | null
          quoted_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          message_id?: string
          position?: number
          quoted_forward_id?: string | null
          quoted_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_replies_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_replies_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_replies_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_quoted_fkey"
            columns: ["quoted_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_replies_quoted_fkey"
            columns: ["quoted_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_replies_quoted_fkey"
            columns: ["quoted_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_replies_quoted_forward_fkey"
            columns: ["quoted_forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_quoted_forward_fkey"
            columns: ["quoted_forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_quoted_forward_fkey"
            columns: ["quoted_forward_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
        ]
      }
      message_revisions: {
        Row: {
          attachments: Json
          author_id: string | null
          chat_id: string
          created_at: string
          id: string
          kind: string
          message_id: string
          text: string | null
          version_at: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          chat_id: string
          created_at?: string
          id?: string
          kind: string
          message_id: string
          text?: string | null
          version_at: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          chat_id?: string
          created_at?: string
          id?: string
          kind?: string
          message_id?: string
          text?: string | null
          version_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_revisions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_revisions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_revisions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_revisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_revisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_revisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_views: {
        Row: {
          counted_at: string
          created_at: string
          id: string
          message_id: string
          session_id: string
          viewer_id: string
        }
        Insert: {
          counted_at?: string
          created_at?: string
          id?: string
          message_id: string
          session_id: string
          viewer_id: string
        }
        Update: {
          counted_at?: string
          created_at?: string
          id?: string
          message_id?: string
          session_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_views_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_views_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_views_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_id: string | null
          chat_id: string
          chat_thread_root_ids: string[] | null
          clusters_count: number
          comments_count: number
          created_at: string
          delayed_until: string | null
          deleted_at: string | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number
          hidden_ranges: unknown
          id: string
          kind: string
          member_reactions: Json
          member_unique_views_count: number
          member_views_count: number
          public_at: string
          public_text: string | null
          reactions_count: number
          read_at: string | null
          seq: number
          source_chat_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          text: string | null
          unique_views_count: number
          views_count: number
          visitor_reactions: Json
        }
        Insert: {
          author_id?: string | null
          chat_id: string
          chat_thread_root_ids?: string[] | null
          clusters_count?: number
          comments_count?: number
          created_at?: string
          delayed_until?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_comment_id?: string | null
          fragments_count?: number
          hidden_ranges?: unknown
          id?: string
          kind: string
          member_reactions?: Json
          member_unique_views_count?: number
          member_views_count?: number
          public_at?: string
          public_text?: string | null
          reactions_count?: number
          read_at?: string | null
          seq?: never
          source_chat_id?: string | null
          stream_id?: string | null
          system_event?: string | null
          system_user_id?: string | null
          text?: string | null
          unique_views_count?: number
          views_count?: number
          visitor_reactions?: Json
        }
        Update: {
          author_id?: string | null
          chat_id?: string
          chat_thread_root_ids?: string[] | null
          clusters_count?: number
          comments_count?: number
          created_at?: string
          delayed_until?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_comment_id?: string | null
          fragments_count?: number
          hidden_ranges?: unknown
          id?: string
          kind?: string
          member_reactions?: Json
          member_unique_views_count?: number
          member_views_count?: number
          public_at?: string
          public_text?: string | null
          reactions_count?: number
          read_at?: string | null
          seq?: never
          source_chat_id?: string | null
          stream_id?: string | null
          system_event?: string | null
          system_user_id?: string | null
          text?: string | null
          unique_views_count?: number
          views_count?: number
          visitor_reactions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_comment_fkey"
            columns: ["forwarded_comment_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_comment_fkey"
            columns: ["forwarded_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_system_user_id_fkey"
            columns: ["system_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pop_views: {
        Row: {
          counted_at: string
          created_at: string
          id: string
          pop_id: string
          session_id: string
          viewer_id: string
        }
        Insert: {
          counted_at?: string
          created_at?: string
          id?: string
          pop_id: string
          session_id: string
          viewer_id: string
        }
        Update: {
          counted_at?: string
          created_at?: string
          id?: string
          pop_id?: string
          session_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pop_views_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pop_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pops: {
        Row: {
          author_id: string | null
          caption: string | null
          channel_id: string
          comments_count: number
          created_at: string
          deleted_at: string | null
          duration_ms: number
          height: number
          id: string
          mime_type: string
          poster_url: string
          reactions: Json
          reactions_count: number
          size_bytes: number | null
          title: string | null
          unique_views_count: number
          url: string
          views_count: number
          width: number
          my_reaction: {
            audience: string
            chat_id: string | null
            created_at: string
            deleted_at: string | null
            emoji: string
            id: string
            target_id: string
            target_type: string
            updated_at: string
            user_id: string | null
          } | null
        }
        Insert: {
          author_id?: string | null
          caption?: string | null
          channel_id: string
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          duration_ms: number
          height: number
          id?: string
          mime_type: string
          poster_url: string
          reactions?: Json
          reactions_count?: number
          size_bytes?: number | null
          title?: string | null
          unique_views_count?: number
          url: string
          views_count?: number
          width: number
        }
        Update: {
          author_id?: string | null
          caption?: string | null
          channel_id?: string
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number
          height?: number
          id?: string
          mime_type?: string
          poster_url?: string
          reactions?: Json
          reactions_count?: number
          size_bytes?: number | null
          title?: string | null
          unique_views_count?: number
          url?: string
          views_count?: number
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "pops_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pops_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_settings: {
        Row: {
          account_search_visibility: string
          activity_status_visibility: string
          alias_window_changes: number
          alias_window_started_at: string | null
          avatar_visibility: string
          birth_date: string | null
          created_at: string
          dialogue_media_visibility: string
          dialogue_participant_name_masking: string
          friends_list_visibility: string
          id: string
          identity_alias: string
          initialized_at: string | null
          message_activity_metadata_visibility: string
          profile_identity_masking: string
          public_message_visibility_delay: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_search_visibility: string
          activity_status_visibility: string
          alias_window_changes?: number
          alias_window_started_at?: string | null
          avatar_visibility: string
          birth_date?: string | null
          created_at?: string
          dialogue_media_visibility: string
          dialogue_participant_name_masking: string
          friends_list_visibility: string
          id?: string
          identity_alias: string
          initialized_at?: string | null
          message_activity_metadata_visibility: string
          profile_identity_masking: string
          public_message_visibility_delay: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_search_visibility?: string
          activity_status_visibility?: string
          alias_window_changes?: number
          alias_window_started_at?: string | null
          avatar_visibility?: string
          birth_date?: string | null
          created_at?: string
          dialogue_media_visibility?: string
          dialogue_participant_name_masking?: string
          friends_list_visibility?: string
          id?: string
          identity_alias?: string
          initialized_at?: string | null
          message_activity_metadata_visibility?: string
          profile_identity_masking?: string
          public_message_visibility_delay?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          status: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id: string
          status?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          status?: string | null
          username?: string | null
        }
        Relationships: []
      }
      reaction_emojis: {
        Row: {
          created_at: string
          emoji: string
          id: string
          is_primary: boolean
          position: number
          valence: number
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          is_primary?: boolean
          position: number
          valence: number
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          is_primary?: boolean
          position?: number
          valence?: number
        }
        Relationships: []
      }
      reactions: {
        Row: {
          audience: string
          chat_id: string | null
          created_at: string
          deleted_at: string | null
          emoji: string
          id: string
          target_id: string
          target_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          audience?: string
          chat_id?: string | null
          created_at?: string
          deleted_at?: string | null
          emoji: string
          id?: string
          target_id: string
          target_type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          audience?: string
          chat_id?: string | null
          created_at?: string
          deleted_at?: string | null
          emoji?: string
          id?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reactions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_emoji_fkey"
            columns: ["emoji"]
            isOneToOne: false
            referencedRelation: "reaction_emojis"
            referencedColumns: ["emoji"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_app_sessions: {
        Row: {
          app_version: string | null
          created_at: string
          end_reason: string | null
          ended_at: string | null
          entry: string | null
          events: number
          foreground_ms: number
          id: string
          impressions: number
          last_screen: string | null
          last_seen_at: string
          platform: string | null
          rebuilt_at: string
          screens: Json
          started_at: string
          tabs: Json
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          entry?: string | null
          events?: number
          foreground_ms?: number
          id: string
          impressions?: number
          last_screen?: string | null
          last_seen_at: string
          platform?: string | null
          rebuilt_at?: string
          screens?: Json
          started_at: string
          tabs?: Json
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          entry?: string | null
          events?: number
          foreground_ms?: number
          id?: string
          impressions?: number
          last_screen?: string | null
          last_seen_at?: string
          platform?: string | null
          rebuilt_at?: string
          screens?: Json
          started_at?: string
          tabs?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_app_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_config: {
        Row: {
          created_at: string
          id: string
          note: string | null
          params: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          params: Json
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          params?: Json
          version?: number
        }
        Relationships: []
      }
      rec_event_keys: {
        Row: {
          client_event_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          client_event_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          client_event_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_event_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_events: {
        Row: {
          app_session_id: string | null
          client_event_id: string | null
          client_ts: string | null
          data: Json
          event_ts: string
          id: string
          impression_id: string | null
          kind: string
          origin: string
          schema_version: number
          screen_session_id: string | null
          server_ts: string
          subject_id: string | null
          subject_type: string | null
          surface: string | null
          user_id: string
        }
        Insert: {
          app_session_id?: string | null
          client_event_id?: string | null
          client_ts?: string | null
          data?: Json
          event_ts?: string
          id?: string
          impression_id?: string | null
          kind: string
          origin: string
          schema_version?: number
          screen_session_id?: string | null
          server_ts?: string
          subject_id?: string | null
          subject_type?: string | null
          surface?: string | null
          user_id: string
        }
        Update: {
          app_session_id?: string | null
          client_event_id?: string | null
          client_ts?: string | null
          data?: Json
          event_ts?: string
          id?: string
          impression_id?: string | null
          kind?: string
          origin?: string
          schema_version?: number
          screen_session_id?: string | null
          server_ts?: string
          subject_id?: string | null
          subject_type?: string | null
          surface?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_hidden_channels: {
        Row: {
          channel_id: string
          created_at: string
          from_pop_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          from_pop_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          from_pop_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_hidden_channels_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_hidden_channels_from_pop_id_fkey"
            columns: ["from_pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_hidden_channels_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_hidden_pops: {
        Row: {
          created_at: string
          id: string
          pop_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pop_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_hidden_pops_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_hidden_pops_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_impressions: {
        Row: {
          algo_version: string | null
          app_session_id: string | null
          applied: Json | null
          applied_at: string | null
          audio_route: string | null
          buffering_count: number
          buffering_ms: number
          channel_hidden: boolean
          channel_id: string | null
          channel_opened: boolean
          comment_chars: number
          comment_reactions: number
          comment_reply: boolean
          comment_voice: boolean
          comments: Json
          comments_sent: number
          completed: boolean
          coverage: number
          coverage_share: number
          created_at: string
          delivery_ok: boolean | null
          duration_ms: number | null
          ended_at: string | null
          entry: string | null
          error: string | null
          exit: string | null
          first_frame_ms: number | null
          forward_chat_kinds: string[]
          forward_recipients: number
          forwards: number
          id: string
          is_publisher: boolean
          labels_closed_at: string | null
          last_seen_at: string
          loops: number
          max_pos_ms: number
          muted: boolean | null
          network: string | null
          not_interested: boolean
          orientation: string | null
          pause_list: Json
          pause_ms: number
          pause_reasons: Json
          pauses: number
          position: number | null
          quick_skip: boolean
          reaction_at: string | null
          reaction_emoji: string | null
          reaction_quick_undo: boolean
          reaction_valence: number | null
          rebuilt_at: string
          request_id: string | null
          returned_later: boolean
          route_changes: Json
          seek_back_ms: number
          seek_fwd_ms: number
          seek_list: Json
          seeks_back: number
          seeks_fwd: number
          segment_ms: number | null
          segments: number | null
          source: string | null
          started_at: string
          subject_id: string
          subject_type: string
          subscribed: boolean
          surface: string
          unsubscribed: boolean
          user_id: string | null
          visible_ms: number
          volume_changes: Json
          volume_max: number | null
          volume_min: number | null
          volume_start: number | null
          watch_ms: number
        }
        Insert: {
          algo_version?: string | null
          app_session_id?: string | null
          applied?: Json | null
          applied_at?: string | null
          audio_route?: string | null
          buffering_count?: number
          buffering_ms?: number
          channel_hidden?: boolean
          channel_id?: string | null
          channel_opened?: boolean
          comment_chars?: number
          comment_reactions?: number
          comment_reply?: boolean
          comment_voice?: boolean
          comments?: Json
          comments_sent?: number
          completed?: boolean
          coverage?: number
          coverage_share?: number
          created_at?: string
          delivery_ok?: boolean | null
          duration_ms?: number | null
          ended_at?: string | null
          entry?: string | null
          error?: string | null
          exit?: string | null
          first_frame_ms?: number | null
          forward_chat_kinds?: string[]
          forward_recipients?: number
          forwards?: number
          id: string
          is_publisher?: boolean
          labels_closed_at?: string | null
          last_seen_at: string
          loops?: number
          max_pos_ms?: number
          muted?: boolean | null
          network?: string | null
          not_interested?: boolean
          orientation?: string | null
          pause_list?: Json
          pause_ms?: number
          pause_reasons?: Json
          pauses?: number
          position?: number | null
          quick_skip?: boolean
          reaction_at?: string | null
          reaction_emoji?: string | null
          reaction_quick_undo?: boolean
          reaction_valence?: number | null
          rebuilt_at?: string
          request_id?: string | null
          returned_later?: boolean
          route_changes?: Json
          seek_back_ms?: number
          seek_fwd_ms?: number
          seek_list?: Json
          seeks_back?: number
          seeks_fwd?: number
          segment_ms?: number | null
          segments?: number | null
          source?: string | null
          started_at: string
          subject_id: string
          subject_type: string
          subscribed?: boolean
          surface: string
          unsubscribed?: boolean
          user_id?: string | null
          visible_ms?: number
          volume_changes?: Json
          volume_max?: number | null
          volume_min?: number | null
          volume_start?: number | null
          watch_ms?: number
        }
        Update: {
          algo_version?: string | null
          app_session_id?: string | null
          applied?: Json | null
          applied_at?: string | null
          audio_route?: string | null
          buffering_count?: number
          buffering_ms?: number
          channel_hidden?: boolean
          channel_id?: string | null
          channel_opened?: boolean
          comment_chars?: number
          comment_reactions?: number
          comment_reply?: boolean
          comment_voice?: boolean
          comments?: Json
          comments_sent?: number
          completed?: boolean
          coverage?: number
          coverage_share?: number
          created_at?: string
          delivery_ok?: boolean | null
          duration_ms?: number | null
          ended_at?: string | null
          entry?: string | null
          error?: string | null
          exit?: string | null
          first_frame_ms?: number | null
          forward_chat_kinds?: string[]
          forward_recipients?: number
          forwards?: number
          id?: string
          is_publisher?: boolean
          labels_closed_at?: string | null
          last_seen_at?: string
          loops?: number
          max_pos_ms?: number
          muted?: boolean | null
          network?: string | null
          not_interested?: boolean
          orientation?: string | null
          pause_list?: Json
          pause_ms?: number
          pause_reasons?: Json
          pauses?: number
          position?: number | null
          quick_skip?: boolean
          reaction_at?: string | null
          reaction_emoji?: string | null
          reaction_quick_undo?: boolean
          reaction_valence?: number | null
          rebuilt_at?: string
          request_id?: string | null
          returned_later?: boolean
          route_changes?: Json
          seek_back_ms?: number
          seek_fwd_ms?: number
          seek_list?: Json
          seeks_back?: number
          seeks_fwd?: number
          segment_ms?: number | null
          segments?: number | null
          source?: string | null
          started_at?: string
          subject_id?: string
          subject_type?: string
          subscribed?: boolean
          surface?: string
          unsubscribed?: boolean
          user_id?: string | null
          visible_ms?: number
          volume_changes?: Json
          volume_max?: number | null
          volume_min?: number | null
          volume_start?: number | null
          watch_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "rec_impressions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_pop_heat: {
        Row: {
          created_at: string
          pauses: number[]
          pop_id: string
          seeks_back_into: number[]
          seeks_fwd_from: number[]
          segment_ms: number
          updated_at: string
          views: number[]
        }
        Insert: {
          created_at?: string
          pauses?: number[]
          pop_id: string
          seeks_back_into?: number[]
          seeks_fwd_from?: number[]
          segment_ms: number
          updated_at?: string
          views?: number[]
        }
        Update: {
          created_at?: string
          pauses?: number[]
          pop_id?: string
          seeks_back_into?: number[]
          seeks_fwd_from?: number[]
          segment_ms?: number
          updated_at?: string
          views?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "rec_pop_heat_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: true
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_pop_hourly: {
        Row: {
          comments: number
          completions: number
          created_at: string
          forwards: number
          hour: string
          id: string
          impressions: number
          not_interested: number
          pop_id: string
          quick_skips: number
          reactions: number
          viewers: number
          watch_ms: number
        }
        Insert: {
          comments?: number
          completions?: number
          created_at?: string
          forwards?: number
          hour: string
          id?: string
          impressions?: number
          not_interested?: number
          pop_id: string
          quick_skips?: number
          reactions?: number
          viewers?: number
          watch_ms?: number
        }
        Update: {
          comments?: number
          completions?: number
          created_at?: string
          forwards?: number
          hour?: string
          id?: string
          impressions?: number
          not_interested?: number
          pop_id?: string
          quick_skips?: number
          reactions?: number
          viewers?: number
          watch_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "rec_pop_hourly_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_pop_stats: {
        Row: {
          channel_hidden: number
          channel_opens: number
          comment_reactions: number
          comments: number
          completions: number
          created_at: string
          delivery_bad: number
          forwards: number
          impressions: number
          impressions_raw: number
          loops: number
          not_interested: number
          pop_id: string
          quick_skips: number
          reaction_valence_sum: number
          reactions: number
          reactions_quick_undo: number
          reactions_removed: number
          updated_at: string
          viewers: number
          viewers_weighted: number
          watch_ms: number
        }
        Insert: {
          channel_hidden?: number
          channel_opens?: number
          comment_reactions?: number
          comments?: number
          completions?: number
          created_at?: string
          delivery_bad?: number
          forwards?: number
          impressions?: number
          impressions_raw?: number
          loops?: number
          not_interested?: number
          pop_id: string
          quick_skips?: number
          reaction_valence_sum?: number
          reactions?: number
          reactions_quick_undo?: number
          reactions_removed?: number
          updated_at?: string
          viewers?: number
          viewers_weighted?: number
          watch_ms?: number
        }
        Update: {
          channel_hidden?: number
          channel_opens?: number
          comment_reactions?: number
          comments?: number
          completions?: number
          created_at?: string
          delivery_bad?: number
          forwards?: number
          impressions?: number
          impressions_raw?: number
          loops?: number
          not_interested?: number
          pop_id?: string
          quick_skips?: number
          reaction_valence_sum?: number
          reactions?: number
          reactions_quick_undo?: number
          reactions_removed?: number
          updated_at?: string
          viewers?: number
          viewers_weighted?: number
          watch_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "rec_pop_stats_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: true
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_pop_viewers: {
        Row: {
          created_at: string
          first_at: string
          id: string
          last_counted_at: string
          pop_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_at: string
          id?: string
          last_counted_at: string
          pop_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          first_at?: string
          id?: string
          last_counted_at?: string
          pop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_pop_viewers_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_pop_viewers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_reject_counts: {
        Row: {
          count: number
          created_at: string
          day: string
          id: string
          kind: string
          reason: string
        }
        Insert: {
          count?: number
          created_at?: string
          day: string
          id?: string
          kind?: string
          reason: string
        }
        Update: {
          count?: number
          created_at?: string
          day?: string
          id?: string
          kind?: string
          reason?: string
        }
        Relationships: []
      }
      rec_rollup_state: {
        Row: {
          created_at: string
          id: boolean
          last_run_at: string | null
          last_summary: Json | null
          watermark: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          last_run_at?: string | null
          last_summary?: Json | null
          watermark?: string
        }
        Update: {
          created_at?: string
          id?: boolean
          last_run_at?: string | null
          last_summary?: Json | null
          watermark?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          chat_id: string | null
          comment: string | null
          created_at: string
          id: string
          reason: string
          reporter_id: string | null
          target_kind: string
          target_user_id: string | null
        }
        Insert: {
          chat_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          reason: string
          reporter_id?: string | null
          target_kind: string
          target_user_id?: string | null
        }
        Update: {
          chat_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string | null
          target_kind?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_config: {
        Row: {
          created_at: string
          id: string
          note: string | null
          params: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          params: Json
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          params?: Json
          version?: number
        }
        Relationships: []
      }
      saved_message_attachments: {
        Row: {
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          media_hidden: boolean
          mime_type: string | null
          owner_id: string
          pop_channel_id: string | null
          pop_id: string | null
          pop_title: string | null
          position: number
          poster_url: string | null
          saved_id: string
          url: string | null
          waveform: number[] | null
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          media_hidden?: boolean
          mime_type?: string | null
          owner_id: string
          pop_channel_id?: string | null
          pop_id?: string | null
          pop_title?: string | null
          position: number
          poster_url?: string | null
          saved_id: string
          url?: string | null
          waveform?: number[] | null
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          media_hidden?: boolean
          mime_type?: string | null
          owner_id?: string
          pop_channel_id?: string | null
          pop_id?: string | null
          pop_title?: string | null
          position?: number
          poster_url?: string | null
          saved_id?: string
          url?: string | null
          waveform?: number[] | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_message_attachments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_message_attachments_pop_channel_id_fkey"
            columns: ["pop_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_message_attachments_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_message_attachments_saved_fkey"
            columns: ["saved_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "saved_messages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      saved_message_tags: {
        Row: {
          created_at: string
          owner_id: string
          saved_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          owner_id: string
          saved_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          owner_id?: string
          saved_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_message_tags_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_message_tags_saved_fkey"
            columns: ["saved_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "saved_messages"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "saved_message_tags_tag_fkey"
            columns: ["tag_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "saved_tags"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      saved_messages: {
        Row: {
          author_id: string | null
          author_name: string | null
          author_opaque: boolean
          client_id: string | null
          comment_message_id: string | null
          comment_pop_id: string | null
          created_at: string
          edited_at: string | null
          id: string
          kind: string
          original_at: string | null
          owner_id: string
          pinned_at: string | null
          pop_id: string | null
          seq: number
          source_category: string
          source_chat_id: string | null
          source_comment_id: string | null
          source_message_id: string | null
          source_seq: number | null
          source_type: string
          text: string | null
          watch_done_at: string | null
          watch_later_at: string | null
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          author_opaque?: boolean
          client_id?: string | null
          comment_message_id?: string | null
          comment_pop_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          kind: string
          original_at?: string | null
          owner_id: string
          pinned_at?: string | null
          pop_id?: string | null
          seq?: never
          source_category: string
          source_chat_id?: string | null
          source_comment_id?: string | null
          source_message_id?: string | null
          source_seq?: number | null
          source_type: string
          text?: string | null
          watch_done_at?: string | null
          watch_later_at?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          author_opaque?: boolean
          client_id?: string | null
          comment_message_id?: string | null
          comment_pop_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: string
          original_at?: string | null
          owner_id?: string
          pinned_at?: string | null
          pop_id?: string | null
          seq?: never
          source_category?: string
          source_chat_id?: string | null
          source_comment_id?: string | null
          source_message_id?: string | null
          source_seq?: number | null
          source_type?: string
          text?: string | null
          watch_done_at?: string | null
          watch_later_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_comment_message_id_fkey"
            columns: ["comment_message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "saved_messages_comment_message_id_fkey"
            columns: ["comment_message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_comment_message_id_fkey"
            columns: ["comment_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_comment_pop_id_fkey"
            columns: ["comment_pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_comment_id_fkey"
            columns: ["source_comment_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_comment_id_fkey"
            columns: ["source_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "saved_messages_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_note_replies: {
        Row: {
          created_at: string
          id: string
          note_id: string
          owner_id: string
          position: number
          quoted_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          owner_id: string
          position: number
          quoted_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          owner_id?: string
          position?: number
          quoted_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_note_replies_note_fkey"
            columns: ["note_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "saved_messages"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "saved_note_replies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_note_replies_quoted_fkey"
            columns: ["quoted_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "saved_messages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      saved_tags: {
        Row: {
          color: number
          created_at: string
          id: string
          name: string
          owner_id: string
          uses_count: number
        }
        Insert: {
          color: number
          created_at?: string
          id?: string
          name: string
          owner_id: string
          uses_count?: number
        }
        Update: {
          color?: number
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "saved_tags_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_request_log: {
        Row: {
          created_at: string
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_request_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_identities: {
        Row: {
          created_at: string
          id: string
          identity: string
          stream_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identity: string
          stream_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identity?: string
          stream_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_identities_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stream_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_participants: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          joined_at: string
          last_event_at: string
          left_at: string | null
          livekit_sid: string | null
          role: string
          stream_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          joined_at: string
          last_event_at: string
          left_at?: string | null
          livekit_sid?: string | null
          role: string
          stream_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          joined_at?: string
          last_event_at?: string
          left_at?: string | null
          livekit_sid?: string | null
          role?: string
          stream_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stream_participants_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stream_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          chat_id: string
          created_at: string
          deleted_at: string | null
          end_reason: string | null
          ended_at: string | null
          host_id: string | null
          id: string
          listeners_count: number
          room_name: string
          speakers_changed_at: string
          speakers_count: number
          started_at: string
          status: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          end_reason?: string | null
          ended_at?: string | null
          host_id?: string | null
          id?: string
          listeners_count?: number
          room_name: string
          speakers_changed_at?: string
          speakers_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          end_reason?: string | null
          ended_at?: string | null
          host_id?: string | null
          id?: string
          listeners_count?: number
          room_name?: string
          speakers_changed_at?: string
          speakers_count?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "streams_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          channel_id: string | null
          chat_id: string | null
          created_at: string
          id: string
          in_chats: boolean
          in_chats_at: string | null
          messages_read_at: string
          notify: boolean
          pops_read_at: string
          subscriber_id: string
        }
        Insert: {
          channel_id?: string | null
          chat_id?: string | null
          created_at?: string
          id?: string
          in_chats?: boolean
          in_chats_at?: string | null
          messages_read_at?: string
          notify?: boolean
          pops_read_at?: string
          subscriber_id: string
        }
        Update: {
          channel_id?: string | null
          chat_id?: string | null
          created_at?: string
          id?: string
          in_chats?: boolean
          in_chats_at?: string | null
          messages_read_at?: string
          notify?: boolean
          pops_read_at?: string
          subscriber_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          online_until: string | null
          session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          online_until?: string | null
          session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          online_until?: string | null
          session_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attachment_rows: {
        Row: {
          duration_ms: number | null
          height: number | null
          id: string | null
          media_hidden: boolean | null
          message_id: string | null
          message_kind: string | null
          mime_type: string | null
          pop_id: string | null
          position: number | null
          poster_url: string | null
          size_bytes: number | null
          url: string | null
          waveform: number[] | null
          width: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_message_kind_fkey"
            columns: ["message_id", "message_kind"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "attachments_message_id_message_kind_fkey"
            columns: ["message_id", "message_kind"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "attachments_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_rows: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          kind: string | null
          last_message_author_id: string | null
          owner_id: string | null
          request_pending: boolean | null
          subscribers_count: number | null
          time_restricted: boolean | null
          title: string | null
          username: string | null
          chat_am_member: boolean | null
          chat_display_name: string | null
          chat_read_up_to: string | null
          last_message_at: string | null
          last_message_preview: string | null
        }
        Relationships: []
      }
      chat_waiting_invitees: {
        Row: {
          avatar_url: string | null
          chat_id: string | null
          display_name: string | null
          invited_at: string | null
          opaque: boolean | null
          user_id: string | null
          username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_attachment_rows: {
        Row: {
          comment_id: string | null
          comment_kind: string | null
          duration_ms: number | null
          height: number | null
          id: string | null
          media_hidden: boolean | null
          mime_type: string | null
          position: number | null
          poster_url: string | null
          size_bytes: number | null
          url: string | null
          waveform: number[] | null
          width: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comment_attachments_comment_fkey"
            columns: ["comment_id", "comment_kind"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "comment_attachments_comment_fkey"
            columns: ["comment_id", "comment_kind"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "kind"]
          },
        ]
      }
      comment_rows: {
        Row: {
          audience: string | null
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          fragment_id: string | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          message_id: string | null
          pop_id: string | null
          rank: number | null
          reactions_count: number | null
          replies_count: number | null
          target_id: string | null
          text: string | null
          thread_root_id: string | null
          visitor_reactions: Json | null
          my_reaction: {
            audience: string
            chat_id: string | null
            created_at: string
            deleted_at: string | null
            emoji: string
            id: string
            target_id: string
            target_type: string
            updated_at: string
            user_id: string | null
          } | null
          reactors: {
            audience: string | null
            avatar_url: string | null
            created_at: string | null
            display_name: string | null
            emoji: string | null
            id: string | null
            opaque: boolean | null
            target_id: string | null
            target_type: string | null
            updated_at: string | null
            user_id: string | null
          } | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_fragment_fkey"
            columns: ["fragment_id", "message_id"]
            isOneToOne: false
            referencedRelation: "fragment_rows"
            referencedColumns: ["id", "message_id"]
          },
          {
            foreignKeyName: "comments_fragment_fkey"
            columns: ["fragment_id", "message_id"]
            isOneToOne: false
            referencedRelation: "message_fragments"
            referencedColumns: ["id", "message_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "comments_pop_id_fkey"
            columns: ["pop_id"]
            isOneToOne: false
            referencedRelation: "pops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_thread_root_fkey"
            columns: ["thread_root_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id", "target_id"]
          },
          {
            foreignKeyName: "comments_thread_root_fkey"
            columns: ["thread_root_id", "target_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "target_id"]
          },
        ]
      }
      fragment_rows: {
        Row: {
          anchor_state: string | null
          chat_id: string | null
          created_at: string | null
          end_offset: number | null
          exact_text: string | null
          id: string | null
          message_id: string | null
          start_offset: number | null
        }
        Insert: {
          anchor_state?: string | null
          chat_id?: string | null
          created_at?: string | null
          end_offset?: number | null
          exact_text?: never
          id?: string | null
          message_id?: string | null
          start_offset?: number | null
        }
        Update: {
          anchor_state?: string | null
          chat_id?: string | null
          created_at?: string | null
          end_offset?: number | null
          exact_text?: never
          id?: string | null
          message_id?: string | null
          start_offset?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "history_element_rows"
            referencedColumns: ["message_id", "chat_id"]
          },
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "message_rows"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_fragments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
        ]
      }
      history_element_rows: {
        Row: {
          chat_id: string | null
          forward_item_id: string | null
          hidden: boolean | null
          id: string | null
          message_id: string | null
          position: number | null
          seq: number | null
          history_element_forward_item: {
            chat_id: string
            created_at: string
            deleted_at: string | null
            forward_id: string
            forward_kind: string
            id: string
            message_id: string
            position: number
          } | null
          history_element_message: {
            author_avatar_url: string | null
            author_id: string | null
            author_name: string | null
            author_opaque: boolean | null
            chat_id: string | null
            chat_thread_root_ids: string[] | null
            clusters_count: number | null
            comments_count: number | null
            created_at: string | null
            deleted_at: string | null
            edit_mark: number | null
            edited: boolean | null
            edited_at: string | null
            forwarded_comment_id: string | null
            fragments_count: number | null
            hidden: boolean | null
            hidden_ranges: Json | null
            id: string | null
            kind: string | null
            member_reactions: Json | null
            reactions_count: number | null
            read_at: string | null
            reads_visible: boolean | null
            seq: number | null
            source_chat_id: string | null
            stream_host_id: string | null
            stream_id: string | null
            system_event: string | null
            system_user_id: string | null
            system_user_name: string | null
            system_user_opaque: boolean | null
            text: string | null
            time_visible: boolean | null
            unique_views_count: number | null
            views_count: number | null
            visitor_reactions: Json | null
          } | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      history_element_windows: {
        Row: {
          after_cursor: Json | null
          anchor: Json | null
          before_cursor: Json | null
          chat_id: string | null
          coverage: Json | null
          element_ids: string[] | null
          has_after: boolean | null
          has_before: boolean | null
          target_status: string | null
          history_window_elements: {
            chat_id: string | null
            forward_item_id: string | null
            hidden: boolean | null
            id: string | null
            message_id: string | null
            position: number | null
            seq: number | null
          } | null
        }
        Relationships: []
      }
      history_window_rows: {
        Row: {
          after_seq: number | null
          anchor_id: string | null
          anchor_seq: number | null
          before_seq: number | null
          chat_id: string | null
          has_after: boolean | null
          has_before: boolean | null
          lower_inclusive: boolean | null
          lower_seq: number | null
          message_ids: string[] | null
          target_status: string | null
          upper_inclusive: boolean | null
          upper_seq: number | null
          history_window_messages: {
            author_avatar_url: string | null
            author_id: string | null
            author_name: string | null
            author_opaque: boolean | null
            chat_id: string | null
            chat_thread_root_ids: string[] | null
            clusters_count: number | null
            comments_count: number | null
            created_at: string | null
            deleted_at: string | null
            edit_mark: number | null
            edited: boolean | null
            edited_at: string | null
            forwarded_comment_id: string | null
            fragments_count: number | null
            hidden: boolean | null
            hidden_ranges: Json | null
            id: string | null
            kind: string | null
            member_reactions: Json | null
            reactions_count: number | null
            read_at: string | null
            reads_visible: boolean | null
            seq: number | null
            source_chat_id: string | null
            stream_host_id: string | null
            stream_id: string | null
            system_event: string | null
            system_user_id: string | null
            system_user_name: string | null
            system_user_opaque: boolean | null
            text: string | null
            time_visible: boolean | null
            unique_views_count: number | null
            views_count: number | null
            visitor_reactions: Json | null
          } | null
        }
        Relationships: []
      }
      message_rows: {
        Row: {
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          chat_thread_root_ids: string[] | null
          clusters_count: number | null
          comments_count: number | null
          created_at: string | null
          deleted_at: string | null
          edit_mark: number | null
          edited: boolean | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number | null
          hidden: boolean | null
          hidden_ranges: Json | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          reactions_count: number | null
          read_at: string | null
          reads_visible: boolean | null
          seq: number | null
          source_chat_id: string | null
          stream_host_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          system_user_name: string | null
          system_user_opaque: boolean | null
          text: string | null
          time_visible: boolean | null
          unique_views_count: number | null
          views_count: number | null
          visitor_reactions: Json | null
          my_reaction: {
            audience: string
            chat_id: string | null
            created_at: string
            deleted_at: string | null
            emoji: string
            id: string
            target_id: string
            target_type: string
            updated_at: string
            user_id: string | null
          } | null
          my_stream_participation: {
            created_at: string
            deleted_at: string | null
            id: string
            joined_at: string
            last_event_at: string
            left_at: string | null
            livekit_sid: string | null
            role: string
            stream_id: string
            user_id: string | null
          } | null
          reactors: {
            audience: string | null
            avatar_url: string | null
            created_at: string | null
            display_name: string | null
            emoji: string | null
            id: string | null
            opaque: boolean | null
            target_id: string | null
            target_type: string | null
            updated_at: string | null
            user_id: string | null
          } | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_comment_fkey"
            columns: ["forwarded_comment_id"]
            isOneToOne: false
            referencedRelation: "comment_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_comment_fkey"
            columns: ["forwarded_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chat_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_source_chat_id_fkey"
            columns: ["source_chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      reactor_rows: {
        Row: {
          audience: string | null
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          emoji: string | null
          id: string | null
          opaque: boolean | null
          target_id: string | null
          target_type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reactions_emoji_fkey"
            columns: ["emoji"]
            isOneToOne: false
            referencedRelation: "reaction_emojis"
            referencedColumns: ["emoji"]
          },
        ]
      }
    }
    Functions: {
      accept_chat_invite: { Args: { target_chat: string }; Returns: undefined }
      accept_friend_request: { Args: { p_user: string }; Returns: string }
      activity_statuses: {
        Args: { user_ids: string[] }
        Returns: {
          last_seen_at: string
          online: boolean
          user_id: string
        }[]
      }
      add_comment_replies: {
        Args: {
          new_comment: string
          reply_to: string[]
          target_message: string
        }
        Returns: undefined
      }
      add_message_replies: {
        Args: { new_message: string; reply_to: string[]; target_chat: string }
        Returns: undefined
      }
      age_in_years: { Args: { p_birth: string }; Returns: number }
      alias_compose: { Args: { p_seed: string }; Returns: string }
      alias_female_names: { Args: never; Returns: string[] }
      alias_feminine_surname: { Args: { p_surname: string }; Returns: string }
      alias_male_names: { Args: never; Returns: string[] }
      alias_random: { Args: never; Returns: string }
      alias_surnames: { Args: never; Returns: string[] }
      am_chat_member: { Args: { p_chat: string }; Returns: boolean }
      apply_message_hidden: {
        Args: {
          m: Database["public"]["Tables"]["messages"]["Row"]
          ranges: unknown
        }
        Returns: undefined
      }
      apply_privacy_defaults: {
        Args: { p_minor: boolean; p_user: string }
        Returns: undefined
      }
      are_friends: { Args: { p_a: string; p_b: string }; Returns: boolean }
      area_fragment_ids: {
        Args: { area_end: number; area_start: number; target_message: string }
        Returns: string[]
      }
      attach_fragment: { Args: { fragment: string }; Returns: string }
      attachment_access: {
        Args: { p_message: string }
        Returns: {
          shown: boolean
          visible: boolean
        }[]
      }
      avatar_object_readable: { Args: { p_name: string }; Returns: boolean }
      block_user: { Args: { p_user: string }; Returns: undefined }
      blocked_pair: { Args: { p_a: string; p_b: string }; Returns: boolean }
      blocker_message_visible: { Args: { p_chat: string }; Returns: boolean }
      call_duration_text: {
        Args: { ended: string; started: string }
        Returns: string
      }
      can_manage_channel: {
        Args: { target_channel: string; who?: string }
        Returns: boolean
      }
      can_manage_chat: {
        Args: { target_chat: string; who?: string }
        Returns: boolean
      }
      can_publish_in_channel:
        | { Args: { target_channel: string }; Returns: boolean }
        | {
            Args: { publisher: string; target_channel: string }
            Returns: boolean
          }
      cancel_chat_invite: {
        Args: { target_chat: string; target_user: string }
        Returns: undefined
      }
      cancel_friend_request: { Args: { p_user: string }; Returns: string }
      channel_info_summary: {
        Args: { target_channel: string }
        Returns: {
          photos: number
          pops: number
          readers: number
          subscribers: number
          videos: number
          voices: number
        }[]
      }
      chat_alias: {
        Args: { p_chat: string; p_person: string }
        Returns: string
      }
      chat_am_member:
        | {
            Args: { "": Database["public"]["Views"]["chat_rows"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_am_member with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
        | {
            Args: { "": Database["public"]["Tables"]["chats"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_am_member with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
      chat_display_name:
        | {
            Args: { "": Database["public"]["Views"]["chat_rows"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_display_name with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
        | {
            Args: { "": Database["public"]["Tables"]["chats"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_display_name with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
      chat_found_by_names: {
        Args: { p_chat: string; p_viewer: string }
        Returns: boolean
      }
      chat_info_summary: {
        Args: { target_chat: string }
        Returns: {
          common_groups: number
          owner_id: string
          photos: number
          videos: number
          voices: number
        }[]
      }
      chat_last_message_time: {
        Args: { p_chat: string; p_viewer: string }
        Returns: string
      }
      chat_last_seen_message: {
        Args: { p_chat: string; p_viewer: string }
        Returns: {
          author_id: string | null
          chat_id: string
          chat_thread_root_ids: string[] | null
          clusters_count: number
          comments_count: number
          created_at: string
          delayed_until: string | null
          deleted_at: string | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number
          hidden_ranges: unknown
          id: string
          kind: string
          member_reactions: Json
          member_unique_views_count: number
          member_views_count: number
          public_at: string
          public_text: string | null
          reactions_count: number
          read_at: string | null
          seq: number
          source_chat_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          text: string | null
          unique_views_count: number
          views_count: number
          visitor_reactions: Json
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_live_stream: {
        Args: { target_chat: string }
        Returns: {
          chat_id: string
          host_id: string
          id: string
          listeners_count: number
          speakers_count: number
          started_at: string
        }[]
      }
      chat_media_object_readable: { Args: { p_name: string }; Returns: boolean }
      chat_opaque_id: {
        Args: { p_chat: string; p_person: string }
        Returns: string
      }
      chat_participant: {
        Args: { p_chat: string; p_person: string }
        Returns: boolean
      }
      chat_people: {
        Args: { chat_ids: string[] }
        Returns: {
          avatar_url: string
          chat_id: string
          display_name: string
          joined_at: string
          last_read_at: string
          opaque: boolean
          position: number
          user_id: string
          username: string
        }[]
      }
      chat_preview_for: {
        Args: { p_chat: string; p_viewer: string }
        Returns: string
      }
      chat_public_hold: { Args: { p_chat: string }; Returns: number }
      chat_read_up_to:
        | {
            Args: { "": Database["public"]["Views"]["chat_rows"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_read_up_to with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
        | {
            Args: { "": Database["public"]["Tables"]["chats"]["Row"] }
            Returns: {
              error: true
            } & "the function public.chat_read_up_to with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
      chat_readable: { Args: { p_chat: string }; Returns: boolean }
      chat_reads_visible: { Args: { p_chat: string }; Returns: boolean }
      chat_row_people: {
        Args: { p_chat: string }
        Returns: {
          created_by: string
          last_message_author_id: string
          owner_id: string
        }[]
      }
      chat_seen: {
        Args: { p_chat: string; p_viewer: string }
        Returns: {
          hold: number
          member: boolean
        }[]
      }
      chat_signal_topic: { Args: { p_chat: string }; Returns: string }
      chat_thread_root_positions: {
        Args: { p_reply: string }
        Returns: {
          id: string
          seq: number
        }[]
      }
      chat_thread_summaries: {
        Args: { p_root_ids: string[] }
        Returns: {
          last_attachments: Json
          last_created_at: string
          last_kind: string
          last_seq: number
          last_text: string
          others_count: number
          people: Json
          replies_count: number
          root_id: string
          viewer_replied: boolean
        }[]
      }
      chat_time_restricted_now: { Args: { p_chat: string }; Returns: boolean }
      chat_time_visible: { Args: { p_chat: string }; Returns: boolean }
      chat_title_for: {
        Args: { p_chat: string; p_viewer: string }
        Returns: string
      }
      chat_visibility: {
        Args: { p_chat: string }
        Returns: {
          reads: boolean
          visible: boolean
        }[]
      }
      check_comment_shape: { Args: { target: string }; Returns: undefined }
      check_contact_request_limit: {
        Args: { p_count: number; p_user: string }
        Returns: undefined
      }
      check_dialogue_retry: {
        Args: { p_me: string; p_peer: string }
        Returns: undefined
      }
      check_message_shape: { Args: { target: string }; Returns: undefined }
      check_saved_note_shape: { Args: { p_saved: string }; Returns: undefined }
      clean_group_avatar_url: { Args: { url: string }; Returns: string }
      clean_own_avatar_url: {
        Args: { folder: string; url: string }
        Returns: string
      }
      cluster_dominant_reaction: {
        Args: { member: Json; previous: string; visitor: Json }
        Returns: string
      }
      comment_attachment_access: {
        Args: { p_comment: string }
        Returns: {
          shown: boolean
          visible: boolean
        }[]
      }
      comment_people: {
        Args: { p_comment: string }
        Returns: {
          author_avatar_url: string
          author_id: string
          author_name: string
          author_opaque: boolean
        }[]
      }
      comment_pin_right: {
        Args: { target: string; who: string }
        Returns: boolean
      }
      comment_rank: {
        Args: { created: string; reactions: number; replies: number }
        Returns: number
      }
      comment_sent_now: {
        Args: { p_comment: string; p_target?: string }
        Returns: boolean
      }
      comment_thread_of: {
        Args: { reply_to: string[]; target_message: string }
        Returns: string
      }
      common_prefix_length: { Args: { a: string; b: string }; Returns: number }
      common_suffix_length: { Args: { a: string; b: string }; Returns: number }
      contact_restricted: { Args: { p_user: string }; Returns: boolean }
      copy_saved_notes: {
        Args: { p_ids: string[]; p_tag_ids?: string[]; p_watch_later?: boolean }
        Returns: string[]
      }
      count_chat_search: {
        Args: { query: string; target_chat: string }
        Returns: number
      }
      count_saved_messages: { Args: { p_filter?: Json }; Returns: number }
      create_channel: {
        Args: {
          channel_avatar_url?: string
          channel_description?: string
          channel_title: string
          channel_username: string
        }
        Returns: Json
      }
      create_chat: {
        Args: {
          chat_avatar_url?: string
          chat_title?: string
          invitee_ids: string[]
          request_text?: string
        }
        Returns: Json
      }
      create_saved_tag: {
        Args: { p_name: string }
        Returns: {
          color: number
          id: string
          name: string
          uses_count: number
        }[]
      }
      current_session_id: { Args: never; Returns: string }
      decline_chat_invite: { Args: { target_chat: string }; Returns: undefined }
      decline_friend_request: { Args: { p_user: string }; Returns: string }
      delete_abandoned_accounts: { Args: never; Returns: number }
      delete_comment: { Args: { target_comment: string }; Returns: undefined }
      delete_direct_chat: { Args: { target_chat: string }; Returns: undefined }
      delete_messages: { Args: { message_ids: string[] }; Returns: undefined }
      delete_saved_messages: { Args: { p_ids: string[] }; Returns: number }
      delete_saved_note_by_client: {
        Args: { p_client_id: string }
        Returns: number
      }
      device_person: { Args: { p_user: string }; Returns: string }
      dialogue_masked: {
        Args: { p_chat: string; p_person: string; p_viewer: string }
        Returns: boolean
      }
      edit_comment: {
        Args: {
          comment_text: string
          media?: Json
          target_comment: string
          voice?: Json
        }
        Returns: undefined
      }
      edit_message: {
        Args: {
          hidden?: Json
          media?: Json
          message_text: string
          target_message: string
          voice?: Json
        }
        Returns: undefined
      }
      edit_saved_note: {
        Args: { p_keep?: string[]; p_saved: string; p_text: string }
        Returns: undefined
      }
      end_device_session: { Args: { p_device_id: string }; Returns: undefined }
      end_other_sessions: { Args: never; Returns: undefined }
      ensure_fragment: {
        Args: {
          range_end: number
          range_start: number
          range_text: string
          target_message: string
        }
        Returns: string
      }
      find_channel_by_username: { Args: { name: string }; Returns: string }
      finish_abandoned_streams: { Args: never; Returns: number }
      finish_stream: {
        Args: { reason: string; target_stream: string }
        Returns: boolean
      }
      forward_comments: {
        Args: { comment_ids: string[]; target_chat: string }
        Returns: string[]
      }
      forward_holding: {
        Args: { target_chat: string; target_message: string }
        Returns: string
      }
      forward_messages: {
        Args: {
          message_ids: string[]
          source_chat: string
          target_chat: string
        }
        Returns: string
      }
      fragment_area_mine: {
        Args: { area_end: number; area_start: number; target_message: string }
        Returns: {
          cluster_id: string
          my_emoji: string
          my_fragment_id: string
        }[]
      }
      fragment_area_summary: {
        Args: { area_end: number; area_start: number; target_message: string }
        Returns: {
          area_text: string
          comments_count: number
          fragment_ids: string[]
          member_reactions: Json
          my_cluster_id: string
          my_emoji: string
          my_fragment_id: string
          people_count: number
          reactions_count: number
          visitor_reactions: Json
        }[]
      }
      fragment_cluster_history_cleanup: { Args: never; Returns: number }
      fragment_cluster_recompute_due: {
        Args: { n: number; params: Json }
        Returns: boolean
      }
      fragment_cluster_settings: {
        Args: never
        Returns: {
          created_at: string
          id: string
          note: string | null
          params: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "fragment_cluster_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fragment_cluster_vote: {
        Args: { cluster: string; delta: number; voter: string }
        Returns: undefined
      }
      fragment_clusters_apply: {
        Args: { result: Json; target_message: string }
        Returns: string
      }
      fragment_clusters_claim: { Args: { batch?: number }; Returns: Json }
      fragment_clusters_dedup: {
        Args: { target_message: string }
        Returns: number
      }
      fragment_clusters_enqueue: {
        Args: { target_message: string }
        Returns: boolean
      }
      fragment_clusters_kick: { Args: never; Returns: boolean }
      fragment_clusters_lock_key: {
        Args: { target_message: string }
        Returns: number
      }
      fragment_clusters_take: {
        Args: { msg_ids: number[]; target_message: string }
        Returns: Json
      }
      fragment_clusters_touch: {
        Args: { force: boolean; interaction: boolean; target_message: string }
        Returns: boolean
      }
      fragment_clusters_writing: { Args: never; Returns: boolean }
      fragment_context_length: { Args: never; Returns: number }
      fragment_from_request: {
        Args: { fragment: Json; target_message: string }
        Returns: string
      }
      fragment_seen_text: { Args: { p_fragment: string }; Returns: string }
      fragment_set_ids: {
        Args: {
          area_end: number
          area_start: number
          cluster: string
          fragment: string
          target_message: string
        }
        Returns: string[]
      }
      friend_request_limit_reached: {
        Args: { p_user: string }
        Returns: boolean
      }
      friends_summary: { Args: { p_user: string }; Returns: Json }
      friendship_of: {
        Args: { p_a: string; p_b: string }
        Returns: {
          accepted_at: string | null
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "friendships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      friendship_seen_as: {
        Args: {
          f: Database["public"]["Tables"]["friendships"]["Row"]
          p_viewer: string
        }
        Returns: string
      }
      friendship_status: { Args: { p_user: string }; Returns: string }
      friendship_status_for: {
        Args: { p_other: string; p_viewer: string }
        Returns: string
      }
      get_history_element_window: {
        Args: {
          p_chat: string
          p_cursor?: Json
          p_hint_position?: number
          p_hint_seq?: number
          p_limit?: number
          p_mode: string
          p_target?: string
          p_target_item?: string
        }
        Returns: {
          after_cursor: Json | null
          anchor: Json | null
          before_cursor: Json | null
          chat_id: string | null
          coverage: Json | null
          element_ids: string[] | null
          has_after: boolean | null
          has_before: boolean | null
          target_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "history_element_windows"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      get_history_elements: {
        Args: { p_chat: string; p_ids: string[] }
        Returns: {
          chat_id: string | null
          forward_item_id: string | null
          hidden: boolean | null
          id: string | null
          message_id: string | null
          position: number | null
          seq: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "history_element_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_history_window: {
        Args: {
          p_chat: string
          p_cursor?: Json
          p_hint_seq?: number
          p_limit?: number
          p_mode: string
          p_target?: string
        }
        Returns: {
          after_seq: number | null
          anchor_id: string | null
          anchor_seq: number | null
          before_seq: number | null
          chat_id: string | null
          has_after: boolean | null
          has_before: boolean | null
          lower_inclusive: boolean | null
          lower_seq: number | null
          message_ids: string[] | null
          target_status: string | null
          upper_inclusive: boolean | null
          upper_seq: number | null
        }
        SetofOptions: {
          from: "*"
          to: "history_window_rows"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      hidden_ranges_from_json: { Args: { value: Json }; Returns: unknown }
      hidden_ranges_json: { Args: { ranges: unknown }; Returns: Json }
      history_element_forward_item: {
        Args: { "": Database["public"]["Views"]["history_element_rows"]["Row"] }
        Returns: {
          chat_id: string
          created_at: string
          deleted_at: string | null
          forward_id: string
          forward_kind: string
          id: string
          message_id: string
          position: number
        }
        SetofOptions: {
          from: "history_element_rows"
          to: "forward_items"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      history_element_message: {
        Args: { "": Database["public"]["Views"]["history_element_rows"]["Row"] }
        Returns: {
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          chat_thread_root_ids: string[] | null
          clusters_count: number | null
          comments_count: number | null
          created_at: string | null
          deleted_at: string | null
          edit_mark: number | null
          edited: boolean | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number | null
          hidden: boolean | null
          hidden_ranges: Json | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          reactions_count: number | null
          read_at: string | null
          reads_visible: boolean | null
          seq: number | null
          source_chat_id: string | null
          stream_host_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          system_user_name: string | null
          system_user_opaque: boolean | null
          text: string | null
          time_visible: boolean | null
          unique_views_count: number | null
          views_count: number | null
          visitor_reactions: Json | null
        }
        SetofOptions: {
          from: "history_element_rows"
          to: "message_rows"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      history_element_slice: {
        Args: {
          p_chat: string
          p_direction: string
          p_inclusive?: boolean
          p_limit: number
          p_position: number
          p_seq: number
          p_visible_only?: boolean
        }
        Returns: {
          chat_id: string | null
          forward_item_id: string | null
          hidden: boolean | null
          id: string | null
          message_id: string | null
          position: number | null
          seq: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "history_element_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      history_window_elements: {
        Args: {
          "": Database["public"]["Views"]["history_element_windows"]["Row"]
        }
        Returns: {
          chat_id: string | null
          forward_item_id: string | null
          hidden: boolean | null
          id: string | null
          message_id: string | null
          position: number | null
          seq: number | null
        }[]
        SetofOptions: {
          from: "history_element_windows"
          to: "history_element_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      history_window_messages: {
        Args: { "": Database["public"]["Views"]["history_window_rows"]["Row"] }
        Returns: {
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          chat_thread_root_ids: string[] | null
          clusters_count: number | null
          comments_count: number | null
          created_at: string | null
          deleted_at: string | null
          edit_mark: number | null
          edited: boolean | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number | null
          hidden: boolean | null
          hidden_ranges: Json | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          reactions_count: number | null
          read_at: string | null
          reads_visible: boolean | null
          seq: number | null
          source_chat_id: string | null
          stream_host_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          system_user_name: string | null
          system_user_opaque: boolean | null
          text: string | null
          time_visible: boolean | null
          unique_views_count: number | null
          views_count: number | null
          visitor_reactions: Json | null
        }[]
        SetofOptions: {
          from: "history_window_rows"
          to: "message_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      identity_allows: {
        Args: { p_person: string; p_value: string; p_viewer: string }
        Returns: boolean
      }
      identity_hmac: { Args: { p_message: string }; Returns: string }
      insert_pop_post: {
        Args: {
          message_text: string
          pop: string
          posts_chat: string
          reply_to: string[]
        }
        Returns: string
      }
      invite_person: {
        Args: { p_invite: string }
        Returns: {
          avatar_url: string
          display_name: string
          opaque: boolean
          user_id: string
          username: string
        }[]
      }
      invite_to_chat: {
        Args: { invitee_ids: string[]; target_chat: string }
        Returns: number
      }
      inviter_avatar_url: {
        Args: { "": Database["public"]["Tables"]["chat_invites"]["Row"] }
        Returns: {
          error: true
        } & "the function public.inviter_avatar_url with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      inviter_name: {
        Args: { "": Database["public"]["Tables"]["chat_invites"]["Row"] }
        Returns: {
          error: true
        } & "the function public.inviter_name with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      is_blocked_by: {
        Args: { p_author: string; p_viewer: string }
        Returns: boolean
      }
      is_comment_thread_root: {
        Args: { root: string; target_message: string }
        Returns: boolean
      }
      is_username_available: {
        Args: { candidate: string; own_id?: string; target_kind: string }
        Returns: boolean
      }
      known_people_ids: {
        Args: { p_me: string }
        Returns: {
          person_id: string
        }[]
      }
      last_message_at:
        | {
            Args: { "": Database["public"]["Views"]["chat_rows"]["Row"] }
            Returns: {
              error: true
            } & "the function public.last_message_at with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
        | {
            Args: { "": Database["public"]["Tables"]["chats"]["Row"] }
            Returns: {
              error: true
            } & "the function public.last_message_at with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
      last_message_preview:
        | {
            Args: { "": Database["public"]["Views"]["chat_rows"]["Row"] }
            Returns: {
              error: true
            } & "the function public.last_message_preview with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
        | {
            Args: { "": Database["public"]["Tables"]["chats"]["Row"] }
            Returns: {
              error: true
            } & "the function public.last_message_preview with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
          }
      latest_chat_messages: {
        Args: { chat_ids: string[]; per_chat?: number }
        Returns: {
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          chat_thread_root_ids: string[] | null
          clusters_count: number | null
          comments_count: number | null
          created_at: string | null
          deleted_at: string | null
          edit_mark: number | null
          edited: boolean | null
          edited_at: string | null
          forwarded_comment_id: string | null
          fragments_count: number | null
          hidden: boolean | null
          hidden_ranges: Json | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          reactions_count: number | null
          read_at: string | null
          reads_visible: boolean | null
          seq: number | null
          source_chat_id: string | null
          stream_host_id: string | null
          stream_id: string | null
          system_event: string | null
          system_user_id: string | null
          system_user_name: string | null
          system_user_opaque: boolean | null
          text: string | null
          time_visible: boolean | null
          unique_views_count: number | null
          views_count: number | null
          visitor_reactions: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "message_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      latest_local_date: { Args: never; Returns: string }
      leave_chat: { Args: { target_chat: string }; Returns: undefined }
      linked_accounts: { Args: { p_user: string }; Returns: string[] }
      list_blocked_users: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: {
          avatar_url: string
          block_id: string
          created_at: string
          display_name: string
          user_id: string
          username: string
        }[]
      }
      list_channel_subscribers: {
        Args: {
          before_created?: string
          before_id?: string
          page_size?: number
          query?: string
          target_channel: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          in_chats: boolean
          subscribed_at: string
          subscriber_id: string
          username: string
        }[]
      }
      list_chat_media: {
        Args: { before_seq?: number; page_size?: number; target_chat: string }
        Returns: {
          attachment_id: string
          created_at: string
          duration_ms: number
          height: number
          media_hidden: boolean
          message_id: string
          mime_type: string
          position: number
          poster_url: string
          seq: number
          url: string
          width: number
        }[]
      }
      list_chat_subscribers: {
        Args: {
          before_created?: string
          before_id?: string
          page_size?: number
          target_chat: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          subscribed_at: string
          subscriber_id: string
          username: string
        }[]
      }
      list_chat_thread: {
        Args: {
          p_after_seq?: number
          p_before_seq?: number
          p_limit?: number
          p_root: string
        }
        Returns: {
          id: string
          quote_ids: string[]
          seq: number
        }[]
      }
      list_chat_thread_deleted_roots: {
        Args: { p_before_seq?: number; p_chat: string; p_limit?: number }
        Returns: {
          id: string
          seq: number
        }[]
      }
      list_chat_voices: {
        Args: { before_seq?: number; page_size?: number; target_chat: string }
        Returns: {
          attachment_id: string
          author_id: string
          author_name: string
          author_opaque: boolean
          created_at: string
          duration_ms: number
          kind: string
          media_hidden: boolean
          message_id: string
          mime_type: string
          poster_url: string
          seq: number
          url: string
          waveform: number[]
        }[]
      }
      list_comment_thread_roots: {
        Args: {
          after_id?: string
          after_rank?: number
          area_end?: number
          area_start?: number
          cluster?: string
          fragment?: string
          page_size?: number
          target: string
        }
        Returns: {
          audience: string | null
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          fragment_id: string | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          message_id: string | null
          pop_id: string | null
          rank: number | null
          reactions_count: number | null
          replies_count: number | null
          target_id: string | null
          text: string | null
          thread_root_id: string | null
          visitor_reactions: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "comment_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_common_groups: {
        Args: {
          before_at?: string
          before_id?: string
          other_user: string
          page_size?: number
        }
        Returns: {
          avatar_url: string
          chat_id: string
          created_at: string
          members_count: number
          title: string
          username: string
        }[]
      }
      list_friends: {
        Args: {
          p_before_accepted_at?: string
          p_before_id?: string
          p_limit?: number
          p_user: string
        }
        Returns: {
          accepted_at: string
          avatar_url: string
          display_name: string
          friendship_id: string
          user_id: string
          username: string
        }[]
      }
      list_incoming_friend_requests: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          friendship_id: string
          user_id: string
          username: string
        }[]
      }
      list_message_clusters: {
        Args: { target_message: string }
        Returns: {
          comments_count: number
          decision_id: string
          display_end: number
          display_start: number
          display_text: string
          dominant_emoji: string
          end_offset: number
          fragments_count: number
          id: string
          member_reactions: Json
          message_id: string
          my_emoji: string
          my_fragment_id: string
          people_count: number
          popularity: number
          reactions_count: number
          start_offset: number
          visitor_reactions: Json
        }[]
      }
      list_message_fragments: {
        Args: { target_message: string }
        Returns: {
          anchor_state: string
          author_id: string
          cluster_id: string
          comments_count: number
          created_at: string
          end_offset: number
          exact_text: string
          id: string
          member_reactions: Json
          message_id: string
          my_emoji: string
          reactions_count: number
          start_offset: number
          visitor_reactions: Json
        }[]
      }
      list_person_chats: {
        Args: { p_limit?: number; p_offset?: number; p_person: string }
        Returns: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          kind: string | null
          last_message_author_id: string | null
          owner_id: string | null
          request_pending: boolean | null
          subscribers_count: number | null
          time_restricted: boolean | null
          title: string | null
          username: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_saved_messages: {
        Args: {
          p_after_seq?: number
          p_before_seq?: number
          p_filter?: Json
          p_limit?: number
        }
        Returns: {
          attachments: Json
          author_avatar_url: string
          author_id: string
          author_name: string
          author_opaque: boolean
          comment_message_id: string
          comment_pop_id: string
          created_at: string
          edited: boolean
          id: string
          kind: string
          original_at: string
          pinned_at: string
          pop_id: string
          replies: Json
          seq: number
          source_category: string
          source_chat_id: string
          source_comment_id: string
          source_message_id: string
          source_seq: number
          source_type: string
          tag_ids: string[]
          text: string
          watch_done_at: string
          watch_later_at: string
        }[]
      }
      list_saved_pins: {
        Args: { p_filter?: Json }
        Returns: {
          id: string
          kind: string
          pinned_at: string
          seq: number
          text: string
          thumbnail_url: string
        }[]
      }
      list_saved_watch_later: {
        Args: {
          p_after_at?: string
          p_after_done?: boolean
          p_after_seq?: number
          p_filter?: Json
          p_limit?: number
        }
        Returns: {
          attachments: Json
          author_avatar_url: string
          author_id: string
          author_name: string
          author_opaque: boolean
          comment_message_id: string
          comment_pop_id: string
          created_at: string
          edited: boolean
          id: string
          kind: string
          original_at: string
          pinned_at: string
          pop_id: string
          replies: Json
          seq: number
          source_category: string
          source_chat_id: string
          source_comment_id: string
          source_message_id: string
          source_seq: number
          source_type: string
          tag_ids: string[]
          text: string
          watch_done_at: string
          watch_later_at: string
        }[]
      }
      lock_fragment_clusters_shared: {
        Args: { target_message: string }
        Returns: undefined
      }
      lock_friend_pair: {
        Args: { p_a: string; p_b: string }
        Returns: undefined
      }
      lock_managed_channel: {
        Args: { target_channel: string; what: string }
        Returns: undefined
      }
      log_fragment_created: {
        Args: { actor: string; fragment: string }
        Returns: undefined
      }
      mark_channel_read: {
        Args: {
          read_pops?: boolean
          read_posts?: boolean
          target_channel: string
        }
        Returns: undefined
      }
      mark_chat_read: { Args: { target_chat: string }; Returns: undefined }
      mark_chat_subscription_read: {
        Args: { target_chat: string }
        Returns: undefined
      }
      mark_device_signed_out: {
        Args: { p_installation_id: string }
        Returns: undefined
      }
      mark_seen: { Args: { online?: boolean }; Returns: undefined }
      mask_hidden_text: {
        Args: { body: string; ranges: unknown }
        Returns: string
      }
      media_object_owned: {
        Args: {
          p_bucket: string
          p_kinds: string[]
          p_owner: string
          p_path: string
        }
        Returns: boolean
      }
      media_visible: {
        Args: { p_author: string; p_channel: boolean; p_chat: string }
        Returns: boolean
      }
      member_event_text: {
        Args: { actor_name: string; event: string; subject_name: string }
        Returns: string
      }
      message_edit_count: { Args: { p_message: string }; Returns: number }
      message_edits: {
        Args: { message_ids: string[] }
        Returns: {
          edit_mark: number
          edited_at: string
          id: string
        }[]
      }
      message_found_by_author: {
        Args: { p_author: string; p_chat: string; p_viewer: string }
        Returns: boolean
      }
      message_payload_people: {
        Args: {
          m: Database["public"]["Tables"]["messages"]["Row"]
          p_viewer: string
        }
        Returns: Json
      }
      message_people: {
        Args: { p_message: string }
        Returns: {
          author_avatar_url: string
          author_id: string
          author_name: string
          author_opaque: boolean
          subject_id: string
          subject_name: string
          subject_opaque: boolean
        }[]
      }
      message_preview_text:
        | {
            Args: { m: Database["public"]["Tables"]["messages"]["Row"] }
            Returns: string
          }
        | {
            Args: {
              m: Database["public"]["Tables"]["messages"]["Row"]
              p_member: boolean
            }
            Returns: string
          }
      message_seen: {
        Args: { p_message: string }
        Returns: {
          member: boolean
          seen: boolean
        }[]
      }
      message_seen_text: {
        Args: { body: string; p_member: boolean; public_body: string }
        Returns: string
      }
      message_sent_now: {
        Args: { p_chat?: string; p_message: string }
        Returns: boolean
      }
      message_seq_seen: {
        Args: { p_chat: string; p_seq: number; p_viewer: string }
        Returns: boolean
      }
      message_shown_in_chat: {
        Args: { target_chat: string; target_message: string; via: string }
        Returns: boolean
      }
      message_signal_topic: {
        Args: { p_chat: string; p_seq: number }
        Returns: string
      }
      message_stream_host: { Args: { p_message: string }; Returns: string }
      message_tombstones: {
        Args: { message_ids: string[] }
        Returns: {
          deleted_at: string
          id: string
        }[]
      }
      my_block_peers: { Args: never; Returns: string[] }
      my_blockers: { Args: never; Returns: string[] }
      my_channel_subscriptions: {
        Args: { target_channel?: string }
        Returns: {
          channel_id: string
          chat_id: string
          in_chats: boolean
          notify: boolean
          unread_pops: number
          unread_posts: number
        }[]
      }
      my_chat_list: {
        Args: never
        Returns: {
          chat_id: string
          entered_at: string
          has_unread: boolean
          position: number
        }[]
      }
      my_privacy_settings: {
        Args: never
        Returns: {
          account_search_visibility: string
          activity_status_visibility: string
          alias_window_changes: number
          alias_window_started_at: string | null
          avatar_visibility: string
          birth_date: string | null
          created_at: string
          dialogue_media_visibility: string
          dialogue_participant_name_masking: string
          friends_list_visibility: string
          id: string
          identity_alias: string
          initialized_at: string | null
          message_activity_metadata_visibility: string
          profile_identity_masking: string
          public_message_visibility_delay: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "privacy_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_reaction:
        | {
            Args: { "": Database["public"]["Views"]["comment_rows"]["Row"] }
            Returns: {
              audience: string
              chat_id: string | null
              created_at: string
              deleted_at: string | null
              emoji: string
              id: string
              target_id: string
              target_type: string
              updated_at: string
              user_id: string | null
            }
            SetofOptions: {
              from: "comment_rows"
              to: "reactions"
              isOneToOne: true
              isSetofReturn: true
            }
          }
        | {
            Args: {
              "": Database["public"]["Tables"]["message_fragments"]["Row"]
            }
            Returns: {
              audience: string
              chat_id: string | null
              created_at: string
              deleted_at: string | null
              emoji: string
              id: string
              target_id: string
              target_type: string
              updated_at: string
              user_id: string | null
            }
            SetofOptions: {
              from: "message_fragments"
              to: "reactions"
              isOneToOne: true
              isSetofReturn: true
            }
          }
        | {
            Args: { "": Database["public"]["Views"]["message_rows"]["Row"] }
            Returns: {
              audience: string
              chat_id: string | null
              created_at: string
              deleted_at: string | null
              emoji: string
              id: string
              target_id: string
              target_type: string
              updated_at: string
              user_id: string | null
            }
            SetofOptions: {
              from: "message_rows"
              to: "reactions"
              isOneToOne: true
              isSetofReturn: true
            }
          }
        | {
            Args: { "": Database["public"]["Tables"]["pops"]["Row"] }
            Returns: {
              audience: string
              chat_id: string | null
              created_at: string
              deleted_at: string | null
              emoji: string
              id: string
              target_id: string
              target_type: string
              updated_at: string
              user_id: string | null
            }
            SetofOptions: {
              from: "pops"
              to: "reactions"
              isOneToOne: true
              isSetofReturn: true
            }
          }
      my_ringing_streams: {
        Args: { since: string }
        Returns: {
          chat_id: string
          host_id: string
          id: string
          listeners_count: number
          speakers_count: number
          started_at: string
        }[]
      }
      my_stream_participation: {
        Args: { "": Database["public"]["Views"]["message_rows"]["Row"] }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          joined_at: string
          last_event_at: string
          left_at: string | null
          livekit_sid: string | null
          role: string
          stream_id: string
          user_id: string | null
        }
        SetofOptions: {
          from: "message_rows"
          to: "stream_participants"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      my_subscriptions: {
        Args: { target_chat?: string }
        Returns: {
          channel_id: string
          chat_id: string
          in_chats: boolean
          in_chats_at: string
          notify: boolean
          unread_pops: number
          unread_posts: number
        }[]
      }
      my_typing_audience: { Args: { target_chat: string }; Returns: string }
      notify_channel_changed: {
        Args: { target_channel: string }
        Returns: undefined
      }
      notify_chat_changed: {
        Args: { extra?: string[]; target_chat: string }
        Returns: undefined
      }
      open_dialogue_request: {
        Args: { p_chat: string; p_peer: string }
        Returns: undefined
      }
      outsider_chat_title: { Args: { target_chat: string }; Returns: string }
      pass_chat_ownership: {
        Args: { leaving: string; target_chat: string }
        Returns: string
      }
      person_card: {
        Args: { p_chat: string; p_person: string; p_viewer: string }
        Returns: Database["public"]["CompositeTypes"]["person_card"]
        SetofOptions: {
          from: "*"
          to: "person_card"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      person_search_candidates: {
        Args: {
          p_fuzzy: boolean
          p_text: string
          p_user_fuzzy: boolean
          p_username: string
        }
        Returns: {
          person_id: string
        }[]
      }
      person_shown_id: {
        Args: { p_chat: string; p_person: string; p_viewer: string }
        Returns: string
      }
      pin_comment: { Args: { target_comment: string }; Returns: undefined }
      pin_message: {
        Args: { in_forward?: string; target_message: string }
        Returns: undefined
      }
      pinned_comment: {
        Args: {
          area_end?: number
          area_start?: number
          cluster?: string
          fragment?: string
          target: string
        }
        Returns: {
          audience: string | null
          author_avatar_url: string | null
          author_id: string | null
          author_name: string | null
          author_opaque: boolean | null
          chat_id: string | null
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          fragment_id: string | null
          id: string | null
          kind: string | null
          member_reactions: Json | null
          message_id: string | null
          pop_id: string | null
          rank: number | null
          reactions_count: number | null
          replies_count: number | null
          target_id: string | null
          text: string | null
          thread_root_id: string | null
          visitor_reactions: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "comment_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      pop_search_score: {
        Args: {
          as_of: string
          comments_count: number
          created_at: string
          reactions_count: number
          views_count: number
        }
        Returns: number
      }
      post_comment: {
        Args: {
          comment_text: string
          fragment?: Json
          media: Json
          reply_to: string[]
          target_message: string
          target_pop: string
          thread_root: string
          voice: Json
        }
        Returns: string
      }
      post_member_event: {
        Args: {
          actor: string
          event: string
          subject?: string
          target_chat: string
        }
        Returns: undefined
      }
      privacy_allows: {
        Args: { p_owner: string; p_setting: string; p_viewer: string }
        Returns: boolean
      }
      privacy_default_settings: { Args: { p_minor: boolean }; Returns: Json }
      privacy_settings_row: {
        Args: { p_minor: boolean; p_user: string }
        Returns: {
          account_search_visibility: string
          activity_status_visibility: string
          alias_window_changes: number
          alias_window_started_at: string | null
          avatar_visibility: string
          birth_date: string | null
          created_at: string
          dialogue_media_visibility: string
          dialogue_participant_name_masking: string
          friends_list_visibility: string
          id: string
          identity_alias: string
          initialized_at: string | null
          message_activity_metadata_visibility: string
          profile_identity_masking: string
          public_message_visibility_delay: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "privacy_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_cards: {
        Args: { ids: string[] }
        Returns: {
          avatar_url: string
          bio: string
          display_name: string
          id: string
          masked: boolean
          status: string
          username: string
        }[]
      }
      public_media_path: { Args: { p_url: string }; Returns: string }
      publish_message_to_viewers: {
        Args: {
          m: Database["public"]["Tables"]["messages"]["Row"]
          signal_chat: boolean
        }
        Returns: undefined
      }
      publish_pop: {
        Args: {
          also_post?: boolean
          caption?: string
          media: Json
          new_pop: string
          post_text?: string
          reply_to?: string[]
          target_channel: string
          title: string
        }
        Returns: Json
      }
      purge_contact_request_log: { Args: never; Returns: undefined }
      purge_friend_request_log: { Args: never; Returns: number }
      purge_search_request_log: { Args: never; Returns: undefined }
      purge_user_presence: { Args: never; Returns: undefined }
      random_publish_delay_seconds: { Args: never; Returns: number }
      reaction_counts_add: {
        Args: { counts: Json; delta: number; emoji: string }
        Returns: Json
      }
      reaction_counts_combine: {
        Args: { a: Json; b: Json; sign: number }
        Returns: Json
      }
      reaction_counts_merge: { Args: { a: Json; b: Json }; Returns: Json }
      reaction_kinds_limit: {
        Args: { audience: string; kind: string }
        Returns: number
      }
      reaction_person: {
        Args: { p_reaction: string }
        Returns: {
          avatar_url: string
          display_name: string
          opaque: boolean
          user_id: string
        }[]
      }
      reaction_target: {
        Args: { kind: string; target: string }
        Returns: {
          channel_id: string
          chat_id: string
          deleted_at: string
          message_id: string
          target_kind: string
        }[]
      }
      reaction_target_seen: { Args: { p_reaction: string }; Returns: boolean }
      reactors:
        | {
            Args: { "": Database["public"]["Views"]["comment_rows"]["Row"] }
            Returns: {
              audience: string | null
              avatar_url: string | null
              created_at: string | null
              display_name: string | null
              emoji: string | null
              id: string | null
              opaque: boolean | null
              target_id: string | null
              target_type: string | null
              updated_at: string | null
              user_id: string | null
            }[]
            SetofOptions: {
              from: "comment_rows"
              to: "reactor_rows"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { "": Database["public"]["Views"]["message_rows"]["Row"] }
            Returns: {
              audience: string | null
              avatar_url: string | null
              created_at: string | null
              display_name: string | null
              emoji: string | null
              id: string | null
              opaque: boolean | null
              target_id: string | null
              target_type: string | null
              updated_at: string | null
              user_id: string | null
            }[]
            SetofOptions: {
              from: "message_rows"
              to: "reactor_rows"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      realtime_chat_readable: { Args: { p_topic: string }; Returns: boolean }
      realtime_topic_member: {
        Args: { p_prefix: string; p_topic: string }
        Returns: boolean
      }
      rec_apply_impressions: { Args: { max_rows: number }; Returns: number }
      rec_count_reject: {
        Args: { event_kind: string; n?: number; why: string }
        Returns: undefined
      }
      rec_impression_heat: {
        Args: { i: Database["public"]["Tables"]["rec_impressions"]["Row"] }
        Returns: Json
      }
      rec_int_array_add: {
        Args: { a: number[]; b: number[]; n: number; sign: number }
        Returns: number[]
      }
      rec_json_ints: { Args: { j: Json }; Returns: number[] }
      rec_label_events: {
        Args: { late: string; person: string; since: string; until: string }
        Returns: {
          data: Json
          event_id: string
          event_ts: string
          impression_id: string
          kind: string
          subject_type: string
        }[]
      }
      rec_log: {
        Args: {
          actor: string
          event_kind: string
          info: Json
          target_id: string
          target_type: string
        }
        Returns: undefined
      }
      rec_num: { Args: { j: Json; key: string }; Returns: number }
      rec_partitions_maintain: { Args: { at?: string }; Returns: Json }
      rec_rebuild_app_sessions: {
        Args: { ids: string[]; since: string }
        Returns: number
      }
      rec_rebuild_impressions: {
        Args: { ids: string[]; since: string }
        Returns: number
      }
      rec_record_events: { Args: { batch: Json }; Returns: Json }
      rec_relabel: { Args: { target: string }; Returns: undefined }
      rec_rollup: { Args: { upto?: string }; Returns: Json }
      rec_segment_ms: { Args: { duration_ms: number }; Returns: number }
      rec_segment_of: {
        Args: { pos_ms: number; segment_ms: number; segments: number }
        Returns: number
      }
      rec_segments: { Args: { duration_ms: number }; Returns: number }
      rec_settings: { Args: never; Returns: Json }
      rec_snapshot_plausible: {
        Args: { cfg: Json; duration_ms: number; elapsed_ms: number; snap: Json }
        Returns: boolean
      }
      rec_text: { Args: { j: Json; key: string }; Returns: string }
      recheck_recent_searches: {
        Args: {
          chat_ids?: string[]
          message_ids: string[]
          person_ids: string[]
        }
        Returns: {
          avatar_url: string
          chat_title: string
          created_at: string
          display_name: string
          id: string
          kind: string
          username: string
        }[]
      }
      reconcile_stream: {
        Args: { connected: Json; room: string }
        Returns: string
      }
      record_fragment_cluster_events: {
        Args: { events: Json }
        Returns: number
      }
      record_message_views: {
        Args: { message_ids: string[]; session_id: string; target_chat: string }
        Returns: undefined
      }
      record_pop_views: {
        Args: { pop_ids: string[]; session_id: string }
        Returns: undefined
      }
      refresh_auto_restriction: { Args: { p_user: string }; Returns: undefined }
      refresh_chat_time_restricted: {
        Args: { p_chat: string }
        Returns: undefined
      }
      refresh_message_clusters: {
        Args: { target_message: string }
        Returns: undefined
      }
      regenerate_identity_alias: { Args: never; Returns: string }
      register_device: {
        Args: {
          p_app_version: string
          p_installation_id: string
          p_model: string
          p_os_version: string
          p_platform: string
        }
        Returns: string
      }
      release_chat_messages: { Args: { p_chat: string }; Returns: undefined }
      release_public_messages: { Args: never; Returns: undefined }
      remember_installation: {
        Args: { p_installation: string; p_user: string }
        Returns: undefined
      }
      remove_chat_member: {
        Args: { target_chat: string; target_user: string }
        Returns: undefined
      }
      remove_forward_items: {
        Args: { message_ids: string[]; target_forward: string }
        Returns: undefined
      }
      remove_friend: { Args: { p_user: string }; Returns: string }
      replace_cluster_reaction: {
        Args: { fragment: string; reactor: string }
        Returns: undefined
      }
      report_user: {
        Args: {
          p_block?: boolean
          p_chat?: string
          p_comment?: string
          p_reason: string
          p_user: string
        }
        Returns: undefined
      }
      require_chat_readable_by: {
        Args: { p_chat: string; p_user: string; p_what: string }
        Returns: undefined
      }
      require_contact_allowed: {
        Args: { p_actor: string; p_author: string; p_chat: string }
        Returns: undefined
      }
      require_friend_target: { Args: { p_other: string }; Returns: string }
      require_not_restricted: { Args: { p_me: string }; Returns: undefined }
      resolve_comment_thread: {
        Args: {
          reply_to: string[]
          target_message: string
          thread_root: string
        }
        Returns: string
      }
      restore_saved_watch_later: {
        Args: { p_done_at?: string; p_later_at: string; p_saved: string }
        Returns: undefined
      }
      safety_int: { Args: { p_key: string }; Returns: number }
      safety_settings: { Args: never; Returns: Json }
      save_comments: {
        Args: {
          p_comment_ids: string[]
          p_tag_ids?: string[]
          p_watch_later?: boolean
        }
        Returns: string[]
      }
      save_messages: {
        Args: {
          p_message_ids: string[]
          p_source_chat: string
          p_tag_ids?: string[]
          p_watch_later?: boolean
        }
        Returns: string[]
      }
      saved_caller: { Args: never; Returns: string }
      saved_category: {
        Args: { p_chat: string; p_viewer: string }
        Returns: string
      }
      saved_filter_of: {
        Args: { p_filter: Json }
        Returns: Database["public"]["CompositeTypes"]["saved_filter"]
        SetofOptions: {
          from: "*"
          to: "saved_filter"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      saved_finish: {
        Args: {
          p_owner: string
          p_saved: string
          p_subject: string
          p_subject_type: string
          p_tags: string[]
        }
        Returns: undefined
      }
      saved_forwardable: {
        Args: { p_ids: string[] }
        Returns: {
          chat_id: string
          comment_id: string
          live: boolean
          message_id: string
          saved_id: string
        }[]
      }
      saved_insert_comment: {
        Args: {
          p_comment: string
          p_owner: string
          p_tags: string[]
          p_watch: boolean
        }
        Returns: string
      }
      saved_insert_message: {
        Args: {
          p_message: string
          p_owner: string
          p_tags: string[]
          p_watch: boolean
        }
        Returns: string
      }
      saved_matches: {
        Args: {
          f: Database["public"]["CompositeTypes"]["saved_filter"]
          s: Database["public"]["Tables"]["saved_messages"]["Row"]
        }
        Returns: boolean
      }
      saved_note_attach: {
        Args: { p_media: Json; p_owner: string; p_saved: string }
        Returns: undefined
      }
      saved_owned: {
        Args: { p_ids: string[]; p_owner: string }
        Returns: string[]
      }
      saved_rows: {
        Args: { p_ids: string[] }
        Returns: {
          attachments: Json
          author_avatar_url: string
          author_id: string
          author_name: string
          author_opaque: boolean
          comment_message_id: string
          comment_pop_id: string
          created_at: string
          edited: boolean
          id: string
          kind: string
          original_at: string
          pinned_at: string
          pop_id: string
          replies: Json
          seq: number
          source_category: string
          source_chat_id: string
          source_comment_id: string
          source_message_id: string
          source_seq: number
          source_type: string
          tag_ids: string[]
          text: string
          watch_done_at: string
          watch_later_at: string
        }[]
      }
      saved_source: {
        Args: { p_saved: string }
        Returns: {
          channel_id: string
          chat_id: string
          comment_id: string
          message_id: string
          pop_channel_id: string
          pop_id: string
          seq: number
          state: string
        }[]
      }
      saved_summary: {
        Args: never
        Returns: {
          watch_later_pending: number
        }[]
      }
      saved_tags_checked: {
        Args: { p_owner: string; p_tag_ids: string[] }
        Returns: string[]
      }
      saved_type: {
        Args: { p_kind: string; p_pop_id: string; p_text: string }
        Returns: string
      }
      search_channels: {
        Args: { max_count?: number; query: string }
        Returns: {
          avatar_url: string
          id: string
          mine: boolean
          posts_chat_id: string
          subscribed: boolean
          subscribers_count: number
          title: string
          username: string
        }[]
      }
      search_chat_messages: {
        Args: {
          before_seq?: number
          page_size?: number
          query: string
          target_chat: string
        }
        Returns: {
          author_id: string
          author_name: string
          author_opaque: boolean
          created_at: string
          message_id: string
          seq: number
          text: string
        }[]
      }
      search_entities: {
        Args: { global_limit?: number; mine_limit?: number; query: string }
        Returns: {
          avatar_url: string
          channel_id: string
          chat_id: string
          entity_kind: string
          id: string
          peer_id: string
          section: string
          subscribed: boolean
          subscribers_count: number
          title: string
          username: string
        }[]
      }
      search_level: { Args: { field: string; needle: string }; Returns: number }
      search_like: { Args: { needle: string }; Returns: string }
      search_messages: {
        Args: { before_seq?: number; page_size?: number; query: string }
        Returns: {
          author_id: string
          author_name: string
          author_opaque: boolean
          channel_id: string
          chat_avatar_url: string
          chat_id: string
          chat_kind: string
          chat_title: string
          created_at: string
          fuzzy: boolean
          message_id: string
          seq: number
          text: string
        }[]
      }
      search_norm: { Args: { value: string }; Returns: string }
      search_parse: {
        Args: { query: string }
        Returns: {
          by_username: boolean
          kind: string
          text_query: string
          username_query: string
        }[]
      }
      search_people: {
        Args: {
          after_id?: string
          after_name?: string
          page_size?: number
          query?: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      search_pops: {
        Args: {
          after_id?: string
          after_rank?: number
          after_score?: number
          as_of?: string
          page_size?: number
          query: string
        }
        Returns: {
          author_id: string
          caption: string
          channel_avatar_url: string
          channel_id: string
          channel_title: string
          comments_count: number
          created_at: string
          duration_ms: number
          height: number
          id: string
          mime_type: string
          my_reaction: string
          poster_url: string
          rank: number
          reactions: Json
          score: number
          scored_at: string
          title: string
          url: string
          views_count: number
          width: number
        }[]
      }
      search_rate_hit: { Args: { p_kind: string }; Returns: undefined }
      search_tsquery: { Args: { needle: string }; Returns: unknown }
      search_tsv: { Args: { value: string }; Returns: unknown }
      search_words: { Args: { value: string }; Returns: string }
      searchable_chat_ids: {
        Args: never
        Returns: {
          chat_id: string
        }[]
      }
      searchable_chats: {
        Args: never
        Returns: {
          avatar_url: string
          channel_id: string
          chat_id: string
          entity_kind: string
          peer_id: string
          subscribed: boolean
          subscribers_count: number
          title: string
          username: string
        }[]
      }
      send_chat_thread_message: {
        Args: {
          p_chat: string
          p_hidden?: Json
          p_media?: Json
          p_reply_to: string[]
          p_reply_via: Json
          p_text?: string
          p_voice?: Json
        }
        Returns: string
      }
      send_comment: {
        Args: {
          comment_text: string
          fragment?: Json
          media?: Json
          reply_to?: string[]
          target_message: string
          thread_root?: string
        }
        Returns: string
      }
      send_friend_request: { Args: { p_user: string }; Returns: string }
      send_media_message: {
        Args: {
          hidden?: Json
          media: Json
          message_text: string
          reply_to?: string[]
          target_chat: string
        }
        Returns: string
      }
      send_pop_comment: {
        Args: {
          comment_text: string
          media?: Json
          reply_to?: string[]
          target_pop: string
          thread_root?: string
        }
        Returns: string
      }
      send_pop_post: {
        Args: {
          message_text?: string
          pop: string
          reply_to?: string[]
          target_chat: string
        }
        Returns: string
      }
      send_saved_note: {
        Args: {
          p_client_id: string
          p_kind?: string
          p_media?: Json
          p_reply_to?: string[]
          p_text?: string
        }
        Returns: string
      }
      send_voice_comment: {
        Args: {
          fragment?: Json
          reply_to?: string[]
          target_message: string
          thread_root?: string
          voice: Json
        }
        Returns: string
      }
      send_voice_message: {
        Args: { reply_to?: string[]; target_chat: string; voice: Json }
        Returns: string
      }
      send_voice_pop_comment: {
        Args: {
          reply_to?: string[]
          target_pop: string
          thread_root?: string
          voice: Json
        }
        Returns: string
      }
      set_birth_date: { Args: { p_birth_date: string }; Returns: Json }
      set_channel_avatar: {
        Args: { new_avatar_url: string; target_channel: string }
        Returns: string
      }
      set_channel_description: {
        Args: { new_description: string; target_channel: string }
        Returns: undefined
      }
      set_channel_hidden: {
        Args: { from_pop?: string; target_channel: string; value: boolean }
        Returns: undefined
      }
      set_channel_in_chats: {
        Args: { target_channel: string; value: boolean }
        Returns: undefined
      }
      set_channel_notifications: {
        Args: { enabled: boolean; target_channel: string }
        Returns: undefined
      }
      set_channel_title: {
        Args: { new_title: string; target_channel: string }
        Returns: undefined
      }
      set_channel_username: {
        Args: { new_username: string; target_channel: string }
        Returns: string
      }
      set_chat_avatar: {
        Args: { new_avatar_url: string; target_chat: string }
        Returns: string
      }
      set_chat_description: {
        Args: { new_description: string; target_chat: string }
        Returns: undefined
      }
      set_chat_notifications: {
        Args: { enabled: boolean; target_chat: string }
        Returns: undefined
      }
      set_chat_title: {
        Args: { new_title: string; target_chat: string }
        Returns: undefined
      }
      set_chat_username: {
        Args: { new_username: string; target_chat: string }
        Returns: string
      }
      set_fragment_reaction: {
        Args: {
          range_end: number
          range_start: number
          range_text: string
          reaction: string
          target_message: string
        }
        Returns: {
          audience: string
          emoji: string
          fragment_id: string
        }[]
      }
      set_message_hidden: {
        Args: {
          hide: boolean
          range_end: number
          range_start: number
          target_message: string
        }
        Returns: Json
      }
      set_pop_not_interested: {
        Args: { target_pop: string; value: boolean }
        Returns: undefined
      }
      set_privacy_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      set_reaction: {
        Args: { reaction: string; target_id: string; target_type: string }
        Returns: {
          audience: string
          emoji: string
        }[]
      }
      set_saved_pinned: {
        Args: { p_ids: string[]; p_pinned: boolean }
        Returns: undefined
      }
      set_saved_tag: {
        Args: { p_on: boolean; p_saved: string; p_tag: string }
        Returns: undefined
      }
      set_saved_watch_later: {
        Args: { p_ids: string[]; p_state: string }
        Returns: undefined
      }
      signal_time_visibility: { Args: { p_chat: string }; Returns: undefined }
      start_call: { Args: { target_chat: string }; Returns: Json }
      stream_identity: {
        Args: { p_stream: string; p_user: string }
        Returns: string
      }
      stream_identity_user: {
        Args: { p_identity: string; p_stream: string }
        Returns: string
      }
      stream_join_info: {
        Args: { caller: string; target_stream: string }
        Returns: Json
      }
      stream_participant_joined: {
        Args: {
          event_at: string
          identity: string
          participant_role: string
          room: string
          sid: string
        }
        Returns: string
      }
      stream_participant_left: {
        Args: { event_at: string; identity: string; room: string; sid: string }
        Returns: string
      }
      stream_people: {
        Args: { target_stream: string }
        Returns: {
          avatar_url: string
          display_name: string
          identity: string
          opaque: boolean
          role: string
          user_id: string
        }[]
      }
      stream_room_finished: { Args: { room: string }; Returns: string }
      subscribe_to_channel: {
        Args: { add_to_chats?: boolean; target_channel: string }
        Returns: undefined
      }
      subscribe_to_chat: { Args: { target_chat: string }; Returns: undefined }
      subscription_unread_messages: {
        Args: { since: string; target_chat: string; viewer: string }
        Returns: number
      }
      subscription_unread_pops: {
        Args: { since: string; target_channel: string; viewer: string }
        Returns: number
      }
      target_seen: { Args: { p_target: string }; Returns: boolean }
      touch_device: { Args: { p_installation_id: string }; Returns: boolean }
      unblock_user: { Args: { p_user: string }; Returns: undefined }
      unpin_comment: { Args: { target: string }; Returns: undefined }
      unpin_message: {
        Args: { target_chat?: string; target_message: string }
        Returns: undefined
      }
      unsubscribe_from_channel: {
        Args: { target_channel: string }
        Returns: undefined
      }
      unsubscribe_from_chat: {
        Args: { target_chat: string }
        Returns: undefined
      }
      uuid_or_null: { Args: { value: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      person_card: {
        id: string | null
        display_name: string | null
        username: string | null
        avatar_url: string | null
        bio: string | null
        status: string | null
        masked: boolean | null
        opaque: boolean | null
      }
      saved_filter: {
        tags: string[] | null
        categories: string[] | null
        from_at: string | null
        to_at: string | null
        types: string[] | null
        tsq: unknown
        pattern: string | null
        searching: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
