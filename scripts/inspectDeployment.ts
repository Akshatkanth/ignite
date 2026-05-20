import { PrismaClient } from '@prisma/client';
(async function(){
  const p = new PrismaClient();
  try{
    const id = process.argv[2] || 'cmpcrrw8m0001rqnvndnv2lxu';
    const d = await p.deployment.findUnique({where:{id}, include:{ project:true, logs:{orderBy:{timestamp:'asc'}}}});
    console.log(JSON.stringify(d, null, 2));
  }catch(e){
    console.error(e);
  }finally{ await p.$disconnect(); }
})();