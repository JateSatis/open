import { supabase } from './supabase';

/** Точка захвата клиента для операций вне React. */
export function requestClient() {
  return supabase;
}
