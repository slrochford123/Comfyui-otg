import {db,ensureMigrations} from "./db";
import {resolveOwnerAlias} from "@/lib/ownerAlias";
/** Only pass a server-authenticated owner or the owner of a persisted job. */
export function isAdminOwner(owner?:string):boolean {
 if(!owner)return false;
 ensureMigrations();
 const admins=db.prepare("SELECT u.id,u.username FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='admin'").all() as {id:string;username:string}[];
 return admins.some(u=>u.id===owner||resolveOwnerAlias(u.username)===owner);
}
