require("dotenv").config();
const Docker = require("dockerode");
const socketPath =
  process.platform === "win32"
    ? "//./pipe/docker_engine"
    : "/var/run/docker.sock";
const docker = new Docker({ socketPath });
const MODE = process.env.MODE || "standalone";
const SWARM_GLOBAL = process.env.SWARM_GLOBAL === "true";
const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_INTERVAL) || 24;
const UNUSED_VOLUME_RETENTION =
  parseInt(process.env.UNUSED_VOLUME_RETENTION) || 7;
const REMOVE_BUILD_CACHE = process.env.REMOVE_BUILD_CACHE === "true";
console.log(`Executando no modo: ${MODE}`);
console.log(`Execução global no Swarm: ${SWARM_GLOBAL}`);
console.log(`Intervalo de manutenção: ${CLEANUP_INTERVAL} hora(s)`);
console.log(
  `Retenção de volumes não usados: ${UNUSED_VOLUME_RETENTION} dia(s)`
);
console.log(`Remover cache de build: ${REMOVE_BUILD_CACHE}`);
console.log(`Usando socket: ${socketPath}`);

async function clearBuildCache() {
  if (!REMOVE_BUILD_CACHE) {
    console.log("Remoção de cache de build está desativada.");
    return;
  }
  console.log("Limpando cache de build...");
  const pruneTime = new Date(Date.now() - 24 * 3600000).toISOString();
  try {
    const containersPrune = await docker.pruneContainers({
      filters: { until: [pruneTime] },
    });
    console.log(`Containers pruned: ${JSON.stringify(containersPrune)}`);
  } catch (err) {
    throw new Error(`Erro ao podar containers: ${err.message}`);
  }
  try {
    const imagesPrune = await docker.pruneImages({
      filters: { dangling: ["false"] },
    });
    console.log(`Images pruned: ${JSON.stringify(imagesPrune)}`);
  } catch (err) {
    throw new Error(`Erro ao podar imagens: ${err.message}`);
  }
  try {
    const networksPrune = await docker.pruneNetworks();
    console.log(`Networks pruned: ${JSON.stringify(networksPrune)}`);
  } catch (err) {
    throw new Error(`Erro ao podar networks: ${err.message}`);
  }
  try {
    const builderPrune = await docker.pruneBuilder();
    console.log(`Builder cache pruned: ${JSON.stringify(builderPrune)}`);
  } catch (err) {
    throw new Error(`Erro ao podar build cache: ${err.message}`);
  }
  console.log("Cache de build limpo.");
}

async function removeContainers() {
  const containers = await docker.listContainers({ all: true });
  const deadContainers = containers.filter(
    (c) =>
      c.Status.toLowerCase().includes("exited") ||
      c.Status.toLowerCase().includes("dead")
  );
  for (const containerInfo of deadContainers) {
    const container = docker.getContainer(containerInfo.Id);
    await container.remove({ force: true });
    console.log(`Container removido: ${containerInfo.Id}`);
  }
}

async function removeVolumes() {
  const volumesData = await docker.listVolumes();
  const volumes = volumesData.Volumes || [];
  const now = new Date();
  for (const volume of volumes) {
    if (volume.UsageData && volume.UsageData.RefCount === 0) {
      if (volume.CreatedAt) {
        const createdAt = new Date(volume.CreatedAt);
        const diffDays = (now - createdAt) / (1000 * 60 * 60 * 24);
        if (diffDays < UNUSED_VOLUME_RETENTION) {
          console.log(
            `Volume ${
              volume.Name
            } não atinge a retenção mínima (${diffDays.toFixed(1)} dia(s))`
          );
          continue;
        }
      }
      await docker.getVolume(volume.Name).remove();
      console.log(`Volume removido: ${volume.Name}`);
    } else {
      console.log(
        `Volume ${volume.Name} está em uso ou não possui dados suficientes para verificação.`
      );
    }
  }
}

async function runMaintenance() {
  console.log("Iniciando manutenção...");
  await clearBuildCache();
  await removeContainers();
  await removeVolumes();
  console.log("Manutenção concluída.");
}

async function start() {
  try {
    if (MODE === "swarm") {
      if (SWARM_GLOBAL) {
        console.log("Executando manutenção em modo global no Swarm.");
        await runMaintenance();
      } else {
        console.log("Executando manutenção em nó específico do Swarm.");
        await runMaintenance();
      }
    } else {
      console.log("Executando manutenção no modo standalone.");
      await runMaintenance();
    }
  } catch (err) {
    console.error("Erro durante a manutenção, parando aplicação:", err);
    process.exit(1);
  }
  setInterval(async () => {
    try {
      await runMaintenance();
    } catch (err) {
      console.error(
        "Erro durante a manutenção agendada, parando aplicação:",
        err
      );
      process.exit(1);
    }
  }, CLEANUP_INTERVAL * 3600000);
}

start();
