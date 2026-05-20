const { captureDeploymentPreview } = require('../apps/api/dist/services/deploymentPreview');
(async()=>{
  const id = process.argv[2] || 'cmpcrrw8m0001rqnvndnv2lxu';
  try{
    console.log('Running capture for', id);
    await captureDeploymentPreview(id);
    console.log('Done');
  }catch(e){
    console.error('Capture failed', e);
  }
})();