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
      attachments: {
        Row: {
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          message_id: string
          message_kind: string
          mime_type: string | null
          position: number
          poster_url: string | null
          size_bytes: number | null
          url: string
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
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url: string
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
          position?: number
          poster_url?: string | null
          size_bytes?: number | null
          url?: string
          waveform?: number[] | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_message_kind_fkey"
            columns: ["message_id", "message_kind"]
            isOneToOne: false
            referencedRelation: "messages"
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
          created_at: string
          created_by: string | null
          deleted_at: string | null
          founding_member_ids: string[]
          id: string
          kind: string
          last_message_at: string | null
          last_message_author_id: string | null
          last_message_text: string | null
          title: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          founding_member_ids?: string[]
          id?: string
          kind: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_text?: string | null
          title?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          founding_member_ids?: string[]
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_text?: string | null
          title?: string | null
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
            referencedRelation: "comments"
            referencedColumns: ["id", "kind"]
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
          message_id: string
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
          message_id: string
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
          message_id?: string
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
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_revisions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
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
          id: string
          kind: string
          message_id: string
          text: string | null
        }
        Insert: {
          audience?: string
          author_id?: string | null
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind: string
          message_id: string
          text?: string | null
        }
        Update: {
          audience?: string
          author_id?: string | null
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          message_id?: string
          text?: string | null
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
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_message_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
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
      message_forwards: {
        Row: {
          created_at: string
          id: string
          message_id: string
          origin_author_id: string | null
          origin_message_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          origin_author_id?: string | null
          origin_message_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          origin_author_id?: string | null
          origin_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_forwards_message_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_forwards_origin_author_id_fkey"
            columns: ["origin_author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_forwards_origin_fkey"
            columns: ["origin_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pins: {
        Row: {
          chat_id: string
          created_at: string
          deleted_at: string | null
          id: string
          message_id: string
          pinned_by: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          message_id: string
          pinned_by?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          message_id?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_pins_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_message_id_chat_id_fkey"
            columns: ["message_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
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
          quoted_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          message_id: string
          position: number
          quoted_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          message_id?: string
          position?: number
          quoted_id?: string
        }
        Relationships: [
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
            referencedRelation: "messages"
            referencedColumns: ["id", "chat_id"]
          },
          {
            foreignKeyName: "message_replies_quoted_fkey"
            columns: ["quoted_id", "chat_id"]
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
            referencedRelation: "chats"
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
      messages: {
        Row: {
          author_id: string | null
          chat_id: string
          comments_count: number
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          kind: string
          member_reactions: Json
          reactions_count: number
          text: string | null
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
          author_id?: string | null
          chat_id: string
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind: string
          member_reactions?: Json
          reactions_count?: number
          text?: string | null
          visitor_reactions?: Json
        }
        Update: {
          author_id?: string | null
          chat_id?: string
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          member_reactions?: Json
          reactions_count?: number
          text?: string | null
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
            referencedRelation: "chats"
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
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          is_primary?: boolean
          position: number
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          is_primary?: boolean
          position?: number
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
    }
    Views: {
      chat_waiting_invitees: {
        Row: {
          avatar_url: string | null
          chat_id: string | null
          display_name: string | null
          invited_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_invites_invitee_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_chat_invite: { Args: { target_chat: string }; Returns: undefined }
      add_message_replies: {
        Args: { new_message: string; reply_to: string[]; target_chat: string }
        Returns: undefined
      }
      check_comment_shape: { Args: { target: string }; Returns: undefined }
      check_message_shape: { Args: { target: string }; Returns: undefined }
      create_chat: {
        Args: { chat_title?: string; invitee_ids: string[] }
        Returns: Json
      }
      current_session_id: { Args: never; Returns: string }
      decline_chat_invite: { Args: { target_chat: string }; Returns: undefined }
      delete_comment: { Args: { target_comment: string }; Returns: undefined }
      delete_messages: { Args: { message_ids: string[] }; Returns: undefined }
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
          media?: Json
          message_text: string
          target_message: string
          voice?: Json
        }
        Returns: undefined
      }
      end_device_session: { Args: { p_device_id: string }; Returns: undefined }
      end_other_sessions: { Args: never; Returns: undefined }
      forward_messages: {
        Args: { message_ids: string[]; target_chat: string }
        Returns: string[]
      }
      latest_chat_messages: {
        Args: { chat_ids: string[]; per_chat?: number }
        Returns: {
          author_id: string | null
          chat_id: string
          comments_count: number
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          kind: string
          member_reactions: Json
          reactions_count: number
          text: string | null
          visitor_reactions: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_chat_read: { Args: { target_chat: string }; Returns: string }
      mark_device_signed_out: {
        Args: { p_installation_id: string }
        Returns: undefined
      }
      message_edits: {
        Args: { message_ids: string[] }
        Returns: {
          edited_at: string
          id: string
        }[]
      }
      message_preview_text: {
        Args: { m: Database["public"]["Tables"]["messages"]["Row"] }
        Returns: string
      }
      message_tombstones: {
        Args: { message_ids: string[] }
        Returns: {
          deleted_at: string
          id: string
        }[]
      }
      my_reaction: {
        Args: { "": Database["public"]["Tables"]["messages"]["Row"] }
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
          from: "messages"
          to: "reactions"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      pin_message: { Args: { target_message: string }; Returns: undefined }
      reaction_counts_add: {
        Args: { counts: Json; delta: number; emoji: string }
        Returns: Json
      }
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
      send_comment: {
        Args: { comment_text: string; media?: Json; target_message: string }
        Returns: string
      }
      send_media_message: {
        Args: {
          media: Json
          message_text: string
          reply_to?: string[]
          target_chat: string
        }
        Returns: string
      }
      send_voice_comment: {
        Args: { target_message: string; voice: Json }
        Returns: string
      }
      send_voice_message: {
        Args: { reply_to?: string[]; target_chat: string; voice: Json }
        Returns: string
      }
      set_reaction: {
        Args: { reaction: string; target_id: string; target_type: string }
        Returns: {
          audience: string
          emoji: string
        }[]
      }
      touch_device: { Args: { p_installation_id: string }; Returns: boolean }
      unpin_message: { Args: { target_message: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
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
