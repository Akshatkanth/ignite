import 'ts-node/register';
import { captureDeploymentPreview } from '../apps/api/src/services/deploymentPreview';
(async function(){
  const id = process.argv[2] || 'cmpcrrw8m0001rqnvndnv2lxu';
  try{
    console.log('Running capture for', id);
    await captureDeploymentPreview(id);
    console.log('Done');
  }catch(e){
    console.error('Capture failed', e);
  }
})();