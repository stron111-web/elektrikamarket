import {etimPage} from '../../../../lib/data';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const params=Object.fromEntries(new URL(request.url).searchParams);
  return Response.json(await etimPage(params),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const changed=message==='ETIM_SNAPSHOT_CHANGED',invalid=message.startsWith('INVALID_ETIM_');
  return Response.json({error:changed?'Ассортимент обновился. Обновите страницу.':invalid?'Некорректный запрос характеристик.':'Не удалось загрузить характеристики. Повторите попытку.'},{status:changed?409:invalid?400:503,headers:{'Cache-Control':'private, no-store'}});
 }
}
